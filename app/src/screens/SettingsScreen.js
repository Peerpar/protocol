/* eslint-disable react-native/no-inline-styles */
import React, { useState, useEffect } from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
} from "react-native";
import { WebView } from "react-native-webview";
import { getDeviceAddress } from "../crypto/signer";

export default function SettingsScreen() {
    const [deviceKey, setDeviceKey] = useState(null);
    const [isLinking, setIsLinking] = useState(false);
    const [showWebView, setShowWebView] = useState(false);

    useEffect(() => {
        async function loadKey() {
            const key = await getDeviceAddress();
            setDeviceKey(key);
        }
        loadKey();
    }, []);

    const handleLinkHardwareInfo = () => {
        setShowWebView(true);
    };

    const handleWebViewMessage = async (event) => {
        const { data } = event.nativeEvent;
        console.log("Received message from WebView:", data);

        try {
            const parsedData = JSON.parse(data);
            if (parsedData.type === 'MOBILE_AUTH_SUCCESS' && parsedData.token) {
                setShowWebView(false);
                setIsLinking(true);

                // Call the API endpoint securely with the session token
                const apiUrl = `${process.env.EXPO_PUBLIC_SOCIAL_WEB_URL || "https://peerpar.org"}/api/auth/link-device`;

                const formData = new FormData();
                formData.append('certifierKey', deviceKey);
                formData.append('deviceName', 'PeerPar Native App');

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${parsedData.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        certifierKey: deviceKey,
                        deviceName: 'PeerPar Mobile',
                    }),
                });

                const result = await response.json();

                if (response.ok) {
                    Alert.alert("Success!", "This hardware device is now permanently linked to your PeerPar social profile.");
                } else {
                    Alert.alert("Error Binding", result.error || "Failed to link device.");
                }
            }
        } catch (e) {
            console.error("Error parsing WebView message:", e);
        } finally {
            setIsLinking(false);
        }
    };

    if (showWebView) {
        // Point to the web platform's login page
        // Inject JS to intercept the session token after successful NextAuth login
        // Note: For a true production build, we'd build a specific /mobile-login page on Next.js 
        // that naturally executes window.ReactNativeWebView.postMessage
        const loginUrl = `${process.env.EXPO_PUBLIC_SOCIAL_WEB_URL || "https://peerpar.org"}/mobile-login`;

        return (
            <View style={{ flex: 1, paddingTop: 40, backgroundColor: "#0F172A" }}>
                <TouchableOpacity
                    style={styles.closeHeader}
                    onPress={() => setShowWebView(false)}
                >
                    <Text style={styles.closeText}>Cancel Linking</Text>
                </TouchableOpacity>
                <WebView
                    source={{ uri: loginUrl }}
                    onMessage={handleWebViewMessage}
                    injectedJavaScript={`true;`}
                />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Text style={styles.headerTitle}>Device Security</Text>

            <View style={styles.card}>
                <Text style={styles.cardTitle}>Identity Binding (Phase 4)</Text>
                <Text style={styles.cardDescription}>
                    To prove that content originated from you, you must link this device's hardware enclave to your verified PeerPar social profile via OAuth.
                </Text>

                <Text style={styles.keyLabel}>Your Secure Enclave Public Key:</Text>
                <Text style={styles.keyValue} selectable>
                    {deviceKey || "Loading..."}
                </Text>

                <TouchableOpacity
                    style={[styles.button, isLinking && styles.buttonDisabled]}
                    onPress={handleLinkHardwareInfo}
                    disabled={isLinking || !deviceKey}
                >
                    {isLinking ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.buttonText}>🔗 Link via PeerPar Social</Text>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#0F172A",
        padding: 20,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: "bold",
        color: "#F8FAFC",
        marginBottom: 20,
    },
    card: {
        backgroundColor: "#1E293B",
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#334155",
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: "600",
        color: "#F8FAFC",
        marginBottom: 10,
    },
    cardDescription: {
        fontSize: 14,
        color: "#94A3B8",
        lineHeight: 20,
        marginBottom: 20,
    },
    keyLabel: {
        fontSize: 12,
        color: "#64748B",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 8,
    },
    keyValue: {
        fontSize: 14,
        fontFamily: "Courier",
        color: "#3B82F6",
        backgroundColor: "#0F172A",
        padding: 12,
        borderRadius: 8,
        overflow: "hidden",
        marginBottom: 24,
    },
    button: {
        backgroundColor: "#8B5CF6",
        padding: 16,
        borderRadius: 12,
        alignItems: "center",
    },
    buttonDisabled: {
        backgroundColor: "#64748B",
        opacity: 0.7,
    },
    buttonText: {
        color: "#FFFFFF",
        fontWeight: "bold",
        fontSize: 16,
    },
    closeHeader: {
        padding: 16,
        alignItems: "flex-end",
    },
    closeText: {
        color: "#EF4444",
        fontWeight: "bold",
    }
});
