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
    Platform,
    ActivityIndicator,
    Alert,
} from "react-native";
import { Camera, CameraType } from "expo-camera";
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
    const [cameraPermission, setCameraPermission] = useState(null);
    const [mediaPermission, setMediaPermission] = useState(null);
    const [locationPermission, setLocationPermission] = useState(null);
    const [facing, setFacing] = useState(CameraType.back);
    const [isCapturing, setIsCapturing] = useState(false);
    const [captureStep, setCaptureStep] = useState("");

    useEffect(() => {
        (async () => {
            const { status: cam } = await Camera.requestCameraPermissionsAsync();
            const { status: media } = await MediaLibrary.requestPermissionsAsync();
            const { status: loc } = await Location.requestForegroundPermissionsAsync();
            setCameraPermission(cam);
            setMediaPermission(media);
            setLocationPermission(loc);
        })();
    }, []);

    async function captureAndAnchor() {
        if (!cameraRef.current || isCapturing) return;
        setIsCapturing(true);

        try {
            // ── STEP 1: Capture photo to temp file (NOT gallery yet) ──────────────
            setCaptureStep("Capturing…");
            const photo = await cameraRef.current.takePictureAsync({
                quality: 1.0,
                skipProcessing: true,     // WHY: avoid any intermediate processing that alters bytes
                exif: false,              // WHY: we record metadata ourselves — EXIF can be stripped/altered
            });
            // photo.uri is a temp file:// path local to the app sandbox.
            // The OS has NOT saved this to the gallery yet.

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
                merkleRoot,
                sha256Hex,
                pHashHex,
                ntpTimestamp: BigInt(ntpResult.timestamp),
                ntpOffsetMs: ntpResult.offsetMs,
                gpsLat: BigInt(gpsLat ?? 0),
                gpsLon: BigInt(gpsLon ?? 0),
                gpsAcc: BigInt(gpsAcc ?? 0),
                ...metadata,
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
                await MediaLibrary.saveToLibraryAsync(photo.uri);
            }

            navigation.navigate("Proof", { proofId });
        } catch (err) {
            console.error("[camera] Capture failed:", err);
            Alert.alert("Capture Failed", err.message);
        } finally {
            setIsCapturing(false);
            setCaptureStep("");
        }
    }

    if (cameraPermission === null) {
        return <View style={styles.center}><ActivityIndicator /></View>;
    }
    if (cameraPermission !== "granted") {
        return (
            <View style={styles.center}>
                <Text style={styles.permissionText}>Camera permission is required.</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Camera ref={cameraRef} style={styles.camera} type={facing}>
                {/* ── Top disclaimer banner ── */}
                <View style={styles.disclaimerBanner}>
                    <Text style={styles.disclaimerText}>{DISCLAIMER_TEXT}</Text>
                </View>

                {/* ── Capture overlay ── */}
                {isCapturing && (
                    <View style={styles.capturingOverlay}>
                        <ActivityIndicator size="large" color="#fff" />
                        <Text style={styles.capturingText}>{captureStep}</Text>
                    </View>
                )}

                {/* ── Bottom controls ── */}
                <View style={styles.controls}>
                    <TouchableOpacity
                        style={styles.flipButton}
                        onPress={() =>
                            setFacing((f) =>
                                f === CameraType.back ? CameraType.front : CameraType.back
                            )
                        }
                    >
                        <Text style={styles.controlText}>Flip</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.captureButton, isCapturing && styles.captureButtonDisabled]}
                        onPress={captureAndAnchor}
                        disabled={isCapturing}
                        accessibilityLabel="Capture and anchor photo"
                        accessibilityRole="button"
                    >
                        <View style={styles.captureInner} />
                    </TouchableOpacity>

                    <View style={{ width: 60 }} />
                </View>
            </Camera>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#000" },
    camera: { flex: 1 },
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

    capturingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.6)",
        justifyContent: "center",
        alignItems: "center",
        gap: 16,
    },
    capturingText: { color: "#fff", fontSize: 16, fontWeight: "600" },

    controls: {
        position: "absolute",
        bottom: 40,
        left: 0,
        right: 0,
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
});
