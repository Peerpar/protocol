/**
 * HistoryScreen.js — Browsable list of all captured proofs from local SQLite
 */

import React, { useEffect, useState, useCallback } from "react";
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    RefreshControl,
    ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getProofs } from "../db/database";

const STATUS_COLOR = {
    confirmed: "#22C55E",
    pending: "#F59E0B",
    failed: "#EF4444",
};

export default function HistoryScreen({ navigation }) {
    const [proofs, setProofs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    async function load(showRefresh = false) {
        if (showRefresh) setRefreshing(true);
        else setLoading(true);
        const data = await getProofs(50);
        setProofs(data);
        setLoading(false);
        setRefreshing(false);
    }

    // Reload whenever the screen comes into focus (e.g., back from ProofScreen)
    useFocusEffect(
        useCallback(() => { load(); }, [])
    );

    function renderItem({ item }) {
        const date = new Date(item.ntp_timestamp * 1000);
        const shortSha = item.sha256_hex.slice(0, 6) + "…" + item.sha256_hex.slice(-4);
        const statusColor = STATUS_COLOR[item.status] || "#94A3B8";

        return (
            <TouchableOpacity
                style={styles.card}
                onPress={() => navigation.navigate("Proof", { proofId: item.id })}
                accessibilityLabel={`Proof from ${date.toLocaleDateString()}, status ${item.status}`}
            >
                <View style={styles.cardHeader}>
                    <View style={[styles.dot, { backgroundColor: statusColor }]} />
                    <Text style={styles.cardStatus}>{item.status.toUpperCase()}</Text>
                    {!item.ntp_reliable && (
                        <View style={styles.clockWarn}>
                            <Text style={styles.clockWarnText}>⚠️ Clock</Text>
                        </View>
                    )}
                </View>
                <Text style={styles.cardDate}>{date.toLocaleString()}</Text>
                <Text style={styles.cardHash}>{shortSha}</Text>
                <Text style={styles.cardMeta}>{item.device_model} · {item.app_version}</Text>
            </TouchableOpacity>
        );
    }

    if (loading) {
        return <View style={styles.center}><ActivityIndicator size="large" color="#3B82F6" /></View>;
    }

    return (
        <View style={styles.container}>
            {/* Reminder disclaimer at the top of the history list */}
            <View style={styles.headerDisclaimer}>
                <Text style={styles.headerDisclaimerText}>
                    ℹ️ Each record proves file existence at time of capture.
                    It does not prove content authenticity.
                </Text>
            </View>

            <FlatList
                data={proofs}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => load(true)}
                        tintColor="#3B82F6"
                    />
                }
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>No proofs yet.</Text>
                        <Text style={styles.emptySubtext}>
                            Capture a photo or video to create your first proof.
                        </Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#0F172A" },
    center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0F172A" },
    list: { padding: 16, paddingBottom: 40 },

    headerDisclaimer: {
        backgroundColor: "#1E293B",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: "#334155",
    },
    headerDisclaimerText: {
        color: "#94A3B8",
        fontSize: 11,
        fontStyle: "italic",
        textAlign: "center",
    },

    card: {
        backgroundColor: "#1E293B",
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    cardStatus: { color: "#94A3B8", fontSize: 10, fontWeight: "700", letterSpacing: 1 },
    clockWarn: { backgroundColor: "#F59E0B20", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
    clockWarnText: { color: "#F59E0B", fontSize: 10, fontWeight: "600" },
    cardDate: { color: "#E2E8F0", fontSize: 14, fontWeight: "600", marginBottom: 4 },
    cardHash: { color: "#60A5FA", fontSize: 11, fontFamily: "monospace", marginBottom: 4 },
    cardMeta: { color: "#64748B", fontSize: 11 },

    emptyState: { alignItems: "center", paddingTop: 80 },
    emptyText: { color: "#E2E8F0", fontSize: 20, fontWeight: "700", marginBottom: 8 },
    emptySubtext: { color: "#64748B", fontSize: 14, textAlign: "center" },
});
