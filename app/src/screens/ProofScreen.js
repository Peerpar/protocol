/**
 * ProofScreen.js — View Proof Details & Verification QR Code
 *
 * This screen answers: "What does my proof actually prove?"
 * It displays ALL cryptographic fields AND an explicit disclaimer about
 * what is and is not proven — as required by the PeerPar trust model.
 *
 * The QR code links to the verification portal with a pre-filled
 * merkleRoot query parameter so the user can share a verifiable link.
 */

import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Platform,
    Alert,
} from "react-native";
// import QRCode from "react-native-qrcode-svg"; // ToDo: re-enable after native build (also line 170 QRCode value={verifyUrl})
import { getProofById } from "../db/database";

const PORTAL_BASE_URL =
    process.env.EXPO_PUBLIC_PORTAL_URL || "https://www.peerpar.org/verificar";

const EXPLORER_URLS = {
    84532: "https://sepolia.basescan.org/tx/",
    8453: "https://basescan.org/tx/",
    2442: "https://testnet-zkevm.polygonscan.com/tx/",
    1101: "https://zkevm.polygonscan.com/tx/",
};

// ─────────────────────────────────────────────────────────────────────────────
// Disclaimer — what IS and IS NOT proven. Displayed prominently at the top.
// ─────────────────────────────────────────────────────────────────────────────
const DISCLAIMER_WHAT_IS_PROVEN = [
    "✅ The exact file existed in this binary form",
    "✅ At approximately the time shown",
    "✅ Signed by this device's hardware-secured key",
    "✅ GPS coordinates were recorded (if shown)",
];
const DISCLAIMER_WHAT_IS_NOT_PROVEN = [
    "❌ That the content is real or accurate",
    "❌ Anything that occurred before the moment of capture",
    "❌ That the GPS coordinates were not spoofed",
    "❌ That the device or app was uncompromised",
];

export default function ProofScreen({ route }) {
    const { proofId } = route.params;
    const [proof, setProof] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isPublishing, setIsPublishing] = useState(false);

    useEffect(() => {
        let interval;
        async function load() {
            const data = await getProofById(proofId);
            setProof(data);
            setLoading(false);

            // Poll until confirmed (relayer is async)
            if (data?.status === "pending") {
                interval = setInterval(async () => {
                    const updated = await getProofById(proofId);
                    setProof(updated);
                    if (updated?.status !== "pending") clearInterval(interval);
                }, 3_000);
            }
        }
        load();
        return () => clearInterval(interval);
    }, [proofId]);

    if (loading) {
        return <View style={styles.center}><ActivityIndicator size="large" /></View>;
    }
    if (!proof) {
        return <View style={styles.center}><Text>Proof not found.</Text></View>;
    }

    const verifyUrl = `${PORTAL_BASE_URL}/verify?root=${encodeURIComponent(proof.merkle_root)}`;
    const explorerUrl = proof.tx_hash
        ? `${EXPLORER_URLS[proof.network_id] || "https://basescan.org/tx/"}${proof.tx_hash}`
        : null;

    const captureDate = new Date(proof.ntp_timestamp * 1000).toLocaleString();

    const handlePublishToSocial = async () => {
        if (!proof.tx_hash) {
            Alert.alert("Pending", "Wait for the blockchain anchor to confirm before publishing.");
            return;
        }

        setIsPublishing(true);
        try {
            const formData = new FormData();

            // Append file
            const fileUri = proof.media_uri;
            const filename = fileUri.split('/').pop();
            const isVideo = filename.endsWith('.mp4') || filename.endsWith('.mov');
            const isAudio = filename.endsWith('.mp3') || filename.endsWith('.m4a') || filename.endsWith('.wav');

            let mimeType = 'image/jpeg';
            let publishType = 'photo';
            if (isVideo) {
                mimeType = 'video/mp4';
                publishType = 'clip';
            } else if (isAudio) {
                mimeType = 'audio/m4a';
                publishType = 'audio';
            }

            formData.append('file', {
                uri: fileUri,
                name: filename,
                type: mimeType,
            });

            formData.append('title', 'Certified Capture');
            formData.append('description', 'Auto-shared from PeerPar Mobile.');
            formData.append('type', publishType);
            formData.append('txHash', proof.tx_hash);
            formData.append('certifierKey', proof.device_address);
            formData.append('merkleRoot', proof.merkle_root);
            formData.append('sha256Hex', proof.sha256_hex);

            // Fetch to local network IP or your actual staging server
            // Ensure process.env.EXPO_PUBLIC_SOCIAL_API_URL is set in the app
            const apiUrl = process.env.EXPO_PUBLIC_SOCIAL_API_URL || "https://www.peerpar.org/api/publish";

            // TODO v0.2.0 — Publishing from app to social layer requires proper auth design.
            // Device-to-social auth should use the user's session token from LinkedDevice,
            // not a shared secret. EXPO_PUBLIC_ variables are visible in the app bundle.
            // Tracking issue: implement OAuth handshake via SettingsScreen WebView flow.
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    // Auth header intentionally removed — see TODO above
                },
                body: formData,
            });

            const data = await response.json();

            if (response.ok) {
                Alert.alert("Success!", "Your certified capture has been posted to PeerPar Social.");
            } else {
                Alert.alert("Failed", data.error || "Failed to publish.");
            }
        } catch (error) {
            Alert.alert("Error", error.message);
        } finally {
            setIsPublishing(false);
        }
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>

            {/* ── Header ── */}
            <Text style={styles.heading}>Proof of Existence</Text>
            <Text style={styles.subheading}>{captureDate}</Text>

            {/* ── Status badge ── */}
            <StatusBadge status={proof.status} ntpReliable={proof.ntp_reliable} />

            {/* ── DISCLAIMER — what is proven ── */}
            <View style={styles.disclaimerCard}>
                <Text style={styles.disclaimerTitle}>What this record proves</Text>
                {DISCLAIMER_WHAT_IS_PROVEN.map((line, i) => (
                    <Text key={i} style={styles.disclaimerLineGood}>{line}</Text>
                ))}
                <View style={styles.divider} />
                <Text style={styles.disclaimerTitle}>What this record does NOT prove</Text>
                {DISCLAIMER_WHAT_IS_NOT_PROVEN.map((line, i) => (
                    <Text key={i} style={styles.disclaimerLineWarn}>{line}</Text>
                ))}
                <View style={styles.disclaimerNoticeBox}>
                    <Text style={styles.disclaimerNoticeText}>
                        "This record proves the file existed in exactly this form at approximately this time.
                        It does not prove the content is real, original, or accurate."
                    </Text>
                </View>
            </View>

            {/* ── Cryptographic fields ── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Cryptographic Fingerprints</Text>
                <FieldRow label="SHA-256" value={proof.sha256_hex} copyable />
                <FieldRow label="pHash (visual)" value={proof.p_hash_hex} copyable />
                <FieldRow label="Merkle Root" value={proof.merkle_root} copyable />
            </View>

            {/* ── On-chain anchor ── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>On-Chain Anchor</Text>
                {proof.tx_hash ? (
                    <>
                        <FieldRow label="Tx Hash" value={proof.tx_hash} copyable />
                        <FieldRow label="Block" value={String(proof.block_number)} />
                        <FieldRow label="Network" value={networkName(proof.network_id)} />
                    </>
                ) : (
                    <Text style={styles.pendingText}>
                        {proof.status === "failed"
                            ? "⚠️ Relayer submission failed. The proof is recorded locally but not yet anchored on-chain."
                            : "⏳ Awaiting on-chain confirmation…"}
                    </Text>
                )}
            </View>

            {/* ── Metadata ── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Capture Metadata</Text>
                <FieldRow label="Time (NTP)" value={captureDate} />
                <FieldRow
                    label="NTP Status"
                    value={proof.ntp_reliable ? "✅ Verified (< 30s drift)" : "⚠️ Unverified (exceeded 30s drift)"}
                />
                {proof.gps_lat != null && (
                    <>
                        <FieldRow label="GPS Lat" value={(proof.gps_lat / 1_000_000).toFixed(6) + "°"} />
                        <FieldRow label="GPS Lon" value={(proof.gps_lon / 1_000_000).toFixed(6) + "°"} />
                        <FieldRow label="GPS Acc" value={(proof.gps_acc / 1_000).toFixed(1) + " m"} />
                    </>
                )}
                <FieldRow label="Device" value={`${proof.device_model} / ${proof.os_version}`} />
                <FieldRow label="App Version" value={proof.app_version} />
                <FieldRow label="Signer Address" value={proof.device_address} copyable />
            </View>

            {/* ── QR Code ── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Verification Link</Text>
                <Text style={styles.verifyUrl} numberOfLines={2}>{verifyUrl}</Text>
                <View style={styles.qrContainer}>
                    {/* <QRCode value={verifyUrl} size={200} backgroundColor="#fff" /> */}
                </View>
                <Text style={styles.qrCaption}>
                    Scan to verify this proof independently at the PeerPar portal.
                    The portal re-hashes an uploaded file in your browser and compares it
                    to this on-chain anchor — no file is sent to any server.
                </Text>
            </View>

            {/* ── Share button ── */}
            <TouchableOpacity
                style={styles.shareButton}
                onPress={() =>
                    Share.share({
                        message: `PeerPar Proof — Verify at: ${verifyUrl}`,
                        url: explorerUrl || verifyUrl,
                    })
                }
            >
                <Text style={styles.shareButtonText}>Share External Link</Text>
            </TouchableOpacity>

            {/* ── Publish to Social Button ── */}
            {proof.tx_hash && (
                <TouchableOpacity
                    style={[styles.shareButton, styles.publishButton, isPublishing && styles.disabledButton]}
                    onPress={handlePublishToSocial}
                    disabled={isPublishing}
                >
                    {isPublishing ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.shareButtonText}>Publish to PeerPar Social 🔗</Text>
                    )}
                </TouchableOpacity>
            )}

        </ScrollView>
    );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status, ntpReliable }) {
    const configs = {
        pending: { bg: "#FFA500", text: "⏳ Anchoring…" },
        confirmed: { bg: "#22C55E", text: "✅ Anchored On-Chain" },
        failed: { bg: "#EF4444", text: "⚠️ Anchor Failed" },
    };
    const { bg, text } = configs[status] || configs.pending;
    return (
        <View style={styles.statusRow}>
            <View style={[styles.statusBadge, { backgroundColor: bg }]}>
                <Text style={styles.statusText}>{text}</Text>
            </View>
            {!ntpReliable && (
                <View style={[styles.statusBadge, { backgroundColor: "#F59E0B" }]}>
                    <Text style={styles.statusText}>⚠️ Clock Drift Flagged</Text>
                </View>
            )}
        </View>
    );
}

function FieldRow({ label, value, copyable }) {
    return (
        <TouchableOpacity
            onPress={() => copyable && Share.share({ message: value })}
            activeOpacity={copyable ? 0.6 : 1}
            style={styles.fieldRow}
        >
            <Text style={styles.fieldLabel}>{label}</Text>
            <Text style={styles.fieldValue} numberOfLines={2} ellipsizeMode="middle">
                {value}
                {copyable ? " 📋" : ""}
            </Text>
        </TouchableOpacity>
    );
}

function networkName(id) {
    const names = {
        84532: "Base Sepolia (testnet)",
        8453: "Base Mainnet",
        2442: "Polygon zkEVM Testnet",
        1101: "Polygon zkEVM",
    };
    return names[id] || `Chain ${id}`;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0F172A" },
    content: { padding: 20, paddingBottom: 60 },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },

    heading: { color: "#F1F5F9", fontSize: 24, fontWeight: "700", marginBottom: 4 },
    subheading: { color: "#94A3B8", fontSize: 13, marginBottom: 16 },

    disclaimerCard: {
        backgroundColor: "#1E293B",
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
        borderLeftWidth: 4,
        borderLeftColor: "#F59E0B",
    },
    disclaimerTitle: { color: "#F1F5F9", fontSize: 13, fontWeight: "700", marginBottom: 6 },
    disclaimerLineGood: { color: "#86EFAC", fontSize: 12, lineHeight: 20 },
    disclaimerLineWarn: { color: "#FCA5A5", fontSize: 12, lineHeight: 20 },
    divider: { height: 1, backgroundColor: "#334155", marginVertical: 10 },
    disclaimerNoticeBox: {
        marginTop: 10,
        backgroundColor: "#0F172A",
        borderRadius: 8,
        padding: 10,
    },
    disclaimerNoticeText: {
        color: "#CBD5E1",
        fontSize: 11,
        fontStyle: "italic",
        lineHeight: 16,
    },

    section: {
        backgroundColor: "#1E293B",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    sectionTitle: {
        color: "#94A3B8",
        fontSize: 11,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 12,
    },
    fieldRow: { marginBottom: 12 },
    fieldLabel: { color: "#64748B", fontSize: 11, marginBottom: 2 },
    fieldValue: { color: "#E2E8F0", fontSize: 12, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },

    statusRow: { flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" },
    statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
    statusText: { color: "#fff", fontSize: 12, fontWeight: "700" },

    pendingText: { color: "#94A3B8", fontSize: 13, lineHeight: 20 },

    qrContainer: { alignItems: "center", marginVertical: 16 },
    verifyUrl: { color: "#60A5FA", fontSize: 11, fontFamily: undefined, marginBottom: 8 },
    qrCaption: { color: "#64748B", fontSize: 11, lineHeight: 16, textAlign: "center" },

    shareButton: {
        backgroundColor: "#3B82F6",
        borderRadius: 12,
        padding: 16,
        alignItems: "center",
        marginTop: 8,
    },
    publishButton: {
        backgroundColor: "#8B5CF6", // Purple to differentiate internal social sharing
        marginTop: 12,
    },
    disabledButton: {
        opacity: 0.7,
    },
    shareButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
