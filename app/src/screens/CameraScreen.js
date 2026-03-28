/**
 * CameraScreen.js — Capture, Hash, Sign, Anchor, Save
 *
 * CHAIN OF CUSTODY ORDER (MUST NOT BE CHANGED):
 *   1. Camera captures frame → raw URI in memory
 *   2. NTP timestamp acquired
 *   3. GPS acquired
 *   4. SHA-256 + pHash computed from file
 *   5. Metadata hash computed
 *   6. Merkle tree built on-device
 *   7. EIP-712 signed
 *   8. Relayer contacted (async — optimistic UI)
 *   9. File saved to gallery ← LAST STEP
 *
 * If the relayer call fails, the file is STILL saved and the proof
 * is marked 'failed' in SQLite. The user can retry submission later.
 */

import React, { useRef, useState, useEffect } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Platform,
    Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Audio } from "expo-av";
import * as MediaLibrary from "expo-media-library";
import * as Location from "expo-location";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { hashMedia } from "../crypto/hasher";
import { buildProofTree } from "../crypto/merkle";
import { signProof } from "../crypto/signer";
import { getNtpTimestamp } from "../services/ntpService";
import { submitProof } from "../services/relayerService";
import { insertProof, confirmProof, failProof } from "../db/database";

// Network config — set via Expo env vars in app.config.js
const CHAIN_ID = parseInt(process.env.EXPO_PUBLIC_CHAIN_ID || "84532", 10);
const CONTRACT_ADDRESS = process.env.EXPO_PUBLIC_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000";

// ─────────────────────────────────────────────────────────────────────────────
// DISCLAIMER (displayed persistently in the UI)
// ─────────────────────────────────────────────────────────────────────────────
const DISCLAIMER_TEXT =
    "This proves the file existed in this form at this time. It does not prove the content is real.";

export default function CameraScreen({ navigation }) {
    const cameraRef = useRef(null);
    const audioRecordingRef = useRef(null);
    const timerRef = useRef(null);

    const [cameraPermission, setCameraPermission] = useState(null);
    const [mediaPermission, setMediaPermission] = useState(null);
    const [locationPermission, setLocationPermission] = useState(null);
    const [audioPermission, setAudioPermission] = useState(null);

    const [facing, setFacing] = useState("back");
    const [captureMode, setCaptureMode] = useState("photo"); // "photo", "video", "audio"
    const [isCapturing, setIsCapturing] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [captureStep, setCaptureStep] = useState("");
    const [recordingTime, setRecordingTime] = useState(0);

    const [camPermission, requestCamPermission] = useCameraPermissions();

    useEffect(() => {
        (async () => {
            await requestCamPermission();
            try {
                const { status: media } = await MediaLibrary.requestPermissionsAsync();
                setMediaPermission(media);
            } catch {
                setMediaPermission("denied");
            }
            try {
                const { status: loc } = await Location.requestForegroundPermissionsAsync();
                setLocationPermission(loc);
            } catch {
                setLocationPermission("denied");
            }
            try {
                const { status: aud } = await Audio.requestPermissionsAsync();
                setAudioPermission(aud);
            } catch {
                setAudioPermission("denied");
            }
        })();

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (audioRecordingRef.current) {
                audioRecordingRef.current.stopAndUnloadAsync().catch(console.error);
            }
        };
    }, []);

    const formatTime = (secs) => {
        const m = Math.floor(secs / 60).toString().padStart(2, "0");
        const s = (secs % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    };

    /**
     * Executes the strict chain of custody flow (Steps 2-9) on a raw media file.
     * Step 1 is handled interchangeably by the photo, video, or audio capturing functions
     * before delegating to this flow with the resulting URI.
     */
    async function processMediaFlow(mediaUri) {
        setIsCapturing(true);

        // ── STEP 1: Capture photo to temp file (NOT gallery yet) ──────────────
        // The raw URI has already been passed into this function.
        // The OS has NOT saved this to the gallery yet.
        const photo = { uri: mediaUri };

        try {
            // ── STEP 2: Acquire NTP timestamp ──────────────────────────────────────
            setCaptureStep("Verifying time…");
            const ntpResult = await getNtpTimestamp();

            // ── STEP 3: Acquire GPS ────────────────────────────────────────────────
            setCaptureStep("Acquiring location…");
            let gpsLat = null, gpsLon = null, gpsAcc = null;
            if (locationPermission === "granted") {
                try {
                    const loc = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.High,
                    });
                    // Scale to integer ×10^6 for ABI encoding (avoids float precision loss)
                    gpsLat = Math.round(loc.coords.latitude * 1_000_000);
                    gpsLon = Math.round(loc.coords.longitude * 1_000_000);
                    gpsAcc = Math.round(loc.coords.accuracy * 1_000);
                } catch {
                    console.warn("[camera] GPS unavailable");
                }
            }

            // ── STEP 4: Hash the file ────────────────────────────────────────────
            // WHY before gallery save: this is the CORE chain-of-custody guarantee.
            // We hash the bytes at this exact moment before any OS processing.
            setCaptureStep("Computing hashes…");
            const metadata = {
                ntpTimestamp: ntpResult.timestamp,
                ntpOffsetMs: ntpResult.offsetMs,
                gpsLat,
                gpsLon,
                gpsAcc,
                deviceModel: Device.modelName || "Unknown",
                osVersion: `${Platform.OS} ${Platform.Version}`,
                appVersion: Constants.expoConfig?.version || "0.1.0",
            };
            const { sha256Hex, pHashHex, metadataHashHex } = await hashMedia(
                photo.uri,
                metadata
            );

            // ── STEP 5: Build Merkle tree ─────────────────────────────────────────
            setCaptureStep("Building proof tree…");
            const { root, leaves, proofs } = await buildProofTree(
                sha256Hex, pHashHex, metadataHashHex
            );
            // Convert root to 0x-prefixed bytes32 for the contract
            const merkleRoot = "0x" + root;

            // ── STEP 6: EIP-712 Sign ──────────────────────────────────────────────
            setCaptureStep("Signing…");
            const payload = {
                ...metadata,
                merkleRoot,
                sha256Hex,
                pHashHex,
                ntpTimestamp: BigInt(ntpResult.timestamp),
                ntpOffsetMs: ntpResult.offsetMs,
                gpsLat: BigInt(gpsLat ?? 0),
                gpsLon: BigInt(gpsLon ?? 0),
                gpsAcc: BigInt(gpsAcc ?? 0),
            };
            const { signature, deviceAddress } = await signProof(
                payload,
                CHAIN_ID,
                CONTRACT_ADDRESS
            );

            // ── STEP 7: Save to local SQLite (pending state) ──────────────────────
            const proofId = await insertProof({
                mediaUri: photo.uri,
                sha256Hex,
                pHashHex,
                metadataHash: metadataHashHex,
                merkleRoot,
                merkleLeaves: leaves,
                merkleProofs: proofs,
                ...metadata,
                deviceAddress,
                ntpReliable: ntpResult.reliable,
            });

            // ── STEP 8: Submit to relayer (async — non-blocking for gallery save) ─
            setCaptureStep("Anchoring on-chain…");
            submitProof(payload, signature, deviceAddress)
                .then(async (result) => {
                    await confirmProof(proofId, {
                        txHash: result.txHash,
                        blockNumber: result.blockNumber,
                        networkId: result.networkId,
                        relayerNtpMs: result.ntpValidation?.relayerNtpTimestampMs,
                        relayerDrift: result.ntpValidation?.driftMs,
                        ntpReliable: result.ntpValidation?.reliable ?? ntpResult.reliable,
                    });
                })
                .catch(async (err) => {
                    console.error("[camera] Relayer submission failed:", err.message);
                    await failProof(proofId, err.message);
                });

            // ── STEP 9: Save file to gallery ─────────────────────────────────────
            // WHY LAST: chain of custody is complete — hash + anchor submitted.
            // The gallery copy is a human-accessible backup; the proof is independent.
            if (mediaPermission === "granted") {
                await MediaLibrary.saveToLibraryAsync(mediaUri);
            }

            navigation.navigate("Proof", { proofId });
        } catch (err) {
            console.error("[camera] Processing failed:", err);
            Alert.alert("Verification Failed", err.message);
        } finally {
            setIsCapturing(false);
            setCaptureStep("");
        }
    }

    async function handlePrimaryAction() {
        if (!cameraRef.current && captureMode !== "audio") return;
        if (isCapturing) return;

        if (captureMode === "photo") {
            setIsCapturing(true);
            setCaptureStep("Capturing…");
            try {
                const photo = await cameraRef.current.takePictureAsync({
                    quality: 1.0,
                    skipProcessing: true,
                    exif: false,
                });
                await processMediaFlow(photo.uri);
            } catch (err) {
                console.error("[camera] Photo capture failed:", err);
                Alert.alert("Capture Failed", err.message);
                setIsCapturing(false);
                setCaptureStep("");
            }
        }
        else if (captureMode === "video") {
            if (isRecording) {
                cameraRef.current.stopRecording();
            } else {
                startVideoRecording();
            }
        }
        else if (captureMode === "audio") {
            if (isRecording) {
                stopAudioRecording();
            } else {
                startAudioRecording();
            }
        }
    }

    async function startVideoRecording() {
        if (!cameraRef.current) return;
        setIsRecording(true);
        setRecordingTime(0);

        timerRef.current = setInterval(() => {
            setRecordingTime((t) => {
                if (t >= 300) {
                    cameraRef.current.stopRecording();
                    return t;
                }
                return t + 1;
            });
        }, 1000);

        try {
            const video = await cameraRef.current.recordAsync({ maxDuration: 300 });
            clearInterval(timerRef.current);
            setIsRecording(false);
            if (video && video.uri) {
                await processMediaFlow(video.uri);
            }
        } catch (err) {
            clearInterval(timerRef.current);
            setIsRecording(false);
            Alert.alert("Video Error", err.message);
        }
    }

    async function startAudioRecording() {
        if (audioPermission !== "granted") {
            Alert.alert("Permission Required", "Microphone access is missing.");
            return;
        }

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            audioRecordingRef.current = recording;

            setIsRecording(true);
            setRecordingTime(0);

            timerRef.current = setInterval(() => {
                setRecordingTime((t) => {
                    if (t >= 300) {
                        stopAudioRecording();
                        return t;
                    }
                    return t + 1;
                });
            }, 1000);
        } catch (err) {
            Alert.alert("Audio Error", err.message);
        }
    }

    async function stopAudioRecording() {
        if (!audioRecordingRef.current) return;

        clearInterval(timerRef.current);
        setIsRecording(false);

        try {
            await audioRecordingRef.current.stopAndUnloadAsync();
            const uri = audioRecordingRef.current.getURI();
            audioRecordingRef.current = null;
            if (uri) {
                await processMediaFlow(uri);
            }
        } catch (err) {
            Alert.alert("Audio Error", err.message);
        }
    }

    if (!camPermission) {
        return <View style={styles.center}><ActivityIndicator /></View>;
    }
    if (!camPermission.granted) {
        return (
            <View style={styles.center}>
                <Text style={styles.permissionText}>Camera permission is required.</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* The camera must remain mounted to prevent errors when switching modes. It is hidden via opacity in audio mode. */}
            <CameraView
                ref={cameraRef}
                style={[StyleSheet.absoluteFill, captureMode === "audio" && { opacity: 0 }]}
                facing={facing}
                mode={captureMode === "video" ? "video" : "picture"}
            />

            {/* UI overlay on top of the camera */}
            <View style={StyleSheet.absoluteFill}>
                {/* ── Top disclaimer banner ── */}
                <View style={styles.disclaimerBanner}>
                    <Text style={styles.disclaimerText}>{DISCLAIMER_TEXT}</Text>
                </View>

                {/* ── Recording Timer Header ── */}
                {(isRecording || (recordingTime > 0 && isCapturing)) && (
                    <View style={styles.recordingStatus}>
                        {isRecording && <View style={styles.redDot} />}
                        <Text style={styles.recordingTime}>
                            {formatTime(recordingTime)} / 05:00
                        </Text>
                    </View>
                )}

                {/* ── Capturing overlay (Processing) ── */}
                {isCapturing && (
                    <View style={styles.capturingOverlay}>
                        <ActivityIndicator size="large" color="#fff" />
                        <Text style={styles.capturingText}>{captureStep}</Text>
                    </View>
                )}

                {/* ── Bottom controls ── */}
                {!isCapturing && (
                    <View style={styles.bottomSection}>

                        {/* ── Mode selector ── */}
                        {!isRecording && (
                            <View style={styles.modeContainer}>
                                {["photo", "video", "audio"].map((mode) => (
                                    <TouchableOpacity key={mode} onPress={() => setCaptureMode(mode)}>
                                        <Text style={[styles.modeText, captureMode === mode && styles.modeTextActive]}>
                                            {mode.toUpperCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

                        <View style={styles.controls}>
                            <TouchableOpacity
                                style={styles.flipButton}
                                onPress={() =>
                                    setFacing((f) =>
                                        f === "back" ? "front" : "back"
                                    )
                                }
                                disabled={isRecording}
                            >
                                <Text style={[styles.controlText, isRecording && { opacity: 0 }]}>
                                    Flip
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.captureButton, isCapturing && styles.captureButtonDisabled]}
                                onPress={handlePrimaryAction}
                                disabled={isCapturing}
                                accessibilityLabel="Capture and anchor media"
                                accessibilityRole="button"
                            >
                                <View style={[
                                    styles.captureInner,
                                    isRecording && styles.captureInnerRecording,
                                    captureMode === "audio" && !isRecording && styles.captureInnerAudio,
                                ]} />
                            </TouchableOpacity>

                            <View style={{ width: 60 }} />
                        </View>
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#000" },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    permissionText: { color: "#fff", textAlign: "center", padding: 20 },

    disclaimerBanner: {
        backgroundColor: "rgba(0,0,0,0.65)",
        paddingHorizontal: 16,
        paddingVertical: 8,
        margin: 12,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: "#F59E0B", // amber — advisory
    },
    disclaimerText: {
        color: "#FEF3C7",
        fontSize: 11,
        fontStyle: "italic",
        textAlign: "center",
    },

    recordingStatus: {
        position: "absolute",
        top: 70,
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(0,0,0,0.6)",
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
    },
    redDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: "#EF4444",
        marginRight: 8
    },
    recordingTime: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "700",
        fontVariant: ["tabular-nums"]
    },

    capturingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.7)",
        justifyContent: "center",
        alignItems: "center",
        gap: 16,
        zIndex: 10,
    },
    capturingText: { color: "#fff", fontSize: 16, fontWeight: "600" },

    bottomSection: {
        position: "absolute",
        bottom: 40,
        left: 0,
        right: 0,
    },
    modeContainer: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 24,
        marginBottom: 24,
    },
    modeText: { color: "#94A3B8", fontSize: 13, fontWeight: "600" },
    modeTextActive: { color: "#FBBF24", fontSize: 13, fontWeight: "700" },

    controls: {
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
        paddingHorizontal: 20,
    },
    flipButton: {
        width: 60,
        alignItems: "center",
        justifyContent: "center",
    },
    controlText: { color: "#fff", fontSize: 14, fontWeight: "600" },

    captureButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        borderWidth: 4,
        borderColor: "#fff",
        justifyContent: "center",
        alignItems: "center",
    },
    captureButtonDisabled: { opacity: 0.5 },
    captureInner: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: "#fff",
    },
    captureInnerRecording: {
        borderRadius: 6,
        width: 32,
        height: 32,
        backgroundColor: "#EF4444"
    },
    captureInnerAudio: {
        backgroundColor: "#8B5CF6"
    },
});
