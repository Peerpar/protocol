import "react-native-get-random-values";
import "@ethersproject/shims";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import HistoryScreen from "./src/screens/HistoryScreen";
import CameraScreen from "./src/screens/CameraScreen";
import ProofScreen from "./src/screens/ProofScreen";

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#0F172A" },
          headerTintColor: "#F1F5F9",
          tabBarStyle: { backgroundColor: "#0F172A", borderTopColor: "#334155" },
          tabBarActiveTintColor: "#3B82F6",
          tabBarInactiveTintColor: "#94A3B8",
        }}
      >
        <Tab.Screen name="Record" component={CameraScreen} />
        <Tab.Screen name="History" component={HistoryScreen} />
        <Tab.Screen name="Proof" component={ProofScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}