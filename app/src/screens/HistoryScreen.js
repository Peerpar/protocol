import React, { useState, useEffect, useCallback } from "react";
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    RefreshControl,
    TouchableOpacity,
    Linking,
    Alert,
} from "react-native";
import { getProofs } from "../db/database";

export default function HistoryScreen() {
    const [proofs, setProofs] = useState([]);
    const [refreshing, setRefreshing] = useState(false);

    const loadProofs = async () => {
        try {
            const data = await getProofs(); // default 50
            setProofs(data);
        } catch (error) {
            console.error("Failed to load proofs:", error);
        }
    };

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadProofs();
        setRefreshing(false);
    }, []);

    // Initial load
    useEffect(() => {
        loadProofs();
    }, []);

    const getMediaType = (uri) => {
        if (!uri) return "Unknown";
        const lower = uri.toLowerCase();
        if (lower.endsWith(".mp4") || lower.endsWith(".mov")) return "Video 🎥";
        if (lower.endsWith(".m4a") || lower.endsWith(".mp3") || lower.endsWith(".wav")) return "Audio 🎙️";
        return "Photo 📷";
    };

    const truncateHash = (hash) => {
        if (!hash || hash.length < 16) return hash;
        return `${hash.substring(0, 8)}...${hash.slice(-8)}`;
    };

    const renderProofCard = ({ item }) => {
        const mediaType = getMediaType(item.media_uri);
        const captureDate = new Date(item.ntp_timestamp * 1000).toLocaleString();
        const hasGps = item.gps_lat != null && item.gps_lon != null;

        let statusColor = "#F59E0B"; // amber (pending)
        let statusText = "Pending";
        if (item.status === "confirmed") {
            statusColor = "#22C55E"; // green
            statusText = "Confirmed";
        } else if (item.status === "failed") {
            statusColor = "#EF4444"; // red
            statusText = "Failed";
        }

        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <Text style={styles.mediaType}>{mediaType}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                        <Text style={styles.statusText}>{statusText}</Text>
                    </View>
                </View>

                <View style={styles.cardBody}>
                    <Text style={styles.label}>SHA-256 Fingerprint</Text>
                    <Text style={styles.valueMono}>{truncateHash(item.sha256_hex)}</Text>

                    <Text style={styles.label}>Date & Time (NTP)</Text>
                    <Text style={styles.value}>{captureDate}</Text>

                    {hasGps && (
                        <>
                            <Text style={styles.label}>Location</Text>
                            <Text style={styles.value}>
                                {(item.gps_lat / 1000000).toFixed(6)}°, {(item.gps_lon / 1000000).toFixed(6)}°
                            </Text>
                        </>
                    )}
                </View>

                {item.status === "confirmed" && item.tx_hash && (
                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => Linking.openURL(`https://sepolia.basescan.org/tx/${item.tx_hash}`)}
                    >
                        <Text style={styles.actionButtonText}>
                            View on Base Sepolia ↗
                        </Text>
                        <Text style={styles.txHashText}>{truncateHash(item.tx_hash)}</Text>
                    </TouchableOpacity>
                )}

                {item.status === "failed" && (
                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: "#3F3F46" }]}
                        onPress={() => Alert.alert("Retry", "Retry coming in v0.2.0")}
                    >
                        <Text style={styles.actionButtonText}>Retry Anchor</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <Text style={styles.headerTitle}>Local Vault</Text>
            <FlatList
                data={proofs}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderProofCard}
                contentContainerStyle={proofs.length === 0 ? styles.emptyContainer : styles.listContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#94A3B8"
                    />
                }
                ListEmptyComponent={
                    <Text style={styles.emptyText}>
                        No captures yet. Use the Record tab to create your first proof.
                    </Text>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#0F172A", // Dark theme background
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: "bold",
        color: "#F8FAFC",
        marginHorizontal: 20,
        marginTop: 20,
        marginBottom: 10,
    },
    listContent: {
        padding: 20,
        paddingBottom: 40,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
    },
    emptyText: {
        color: "#94A3B8",
        fontSize: 16,
        textAlign: "center",
        lineHeight: 24,
    },
    card: {
        backgroundColor: "#1E293B",
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: "#334155",
    },
    cardHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: "#334155",
    },
    mediaType: {
        color: "#E2E8F0",
        fontSize: 16,
        fontWeight: "600",
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: "bold",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    cardBody: {
        marginBottom: 16,
    },
    label: {
        color: "#64748B",
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 4,
        marginTop: 12,
    },
    value: {
        color: "#F8FAFC",
        fontSize: 14,
    },
    valueMono: {
        color: "#F8FAFC",
        fontSize: 14,
        fontFamily: "Courier",
    },
    actionButton: {
        backgroundColor: "#2563EB",
        borderRadius: 8,
        padding: 12,
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
    },
    actionButtonText: {
        color: "#FFFFFF",
        fontWeight: "600",
        fontSize: 14,
    },
    txHashText: {
        color: "#BFDBFE",
        fontFamily: "Courier",
        fontSize: 12,
    },
});