import { View, ActivityIndicator } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";

import { AuthProvider, useAuth } from "./src/context/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import BookingScreen from "./src/screens/BookingScreen";
import ScheduleScreen from "./src/screens/ScheduleScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import ManagementScheduleScreen from "./src/screens/ManagementScheduleScreen";
import ScheduleBuilderScreen from "./src/screens/ScheduleBuilderScreen";
import AccountsScreen from "./src/screens/AccountsScreen";
import { COLORS } from "./src/theme";

const Tab = createBottomTabNavigator();

const tabBarOptions = {
  headerShown: false,
  tabBarActiveTintColor: COLORS.ink,
  tabBarInactiveTintColor: COLORS.tabInactive,
  tabBarStyle: { backgroundColor: COLORS.card, borderTopColor: COLORS.line, paddingBottom: 8, height: 62 },
  tabBarLabelStyle: { fontSize: 10.5, fontWeight: "700" },
};

function CustomerNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...tabBarOptions,
        tabBarIcon: ({ color }) => {
          const map = { Trang_chu: "home", Dat_lich: "calendar", Lich_cua_toi: "clock", Ca_nhan: "user" };
          return <Feather name={map[route.name]} size={19} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Trang_chu" component={HomeScreen} options={{ title: "Trang chủ" }} />
      <Tab.Screen name="Dat_lich" component={BookingScreen} options={{ title: "Đặt lịch" }} />
      <Tab.Screen name="Lich_cua_toi" component={ScheduleScreen} options={{ title: "Lịch của tôi" }} />
      <Tab.Screen name="Ca_nhan" component={ProfileScreen} options={{ title: "Cá nhân" }} />
    </Tab.Navigator>
  );
}

// HLV: chỉ xem lịch dạy của chính mình, không có quyền quản trị
function TrainerNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...tabBarOptions,
        tabBarIcon: ({ color }) => {
          const map = { Lich_khach: "calendar", Ca_nhan: "user" };
          return <Feather name={map[route.name]} size={19} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Lich_khach" component={ManagementScheduleScreen} options={{ title: "Lịch dạy" }} />
      <Tab.Screen name="Ca_nhan" component={ProfileScreen} options={{ title: "Cá nhân" }} />
    </Tab.Navigator>
  );
}

// Lễ tân (reception) + admin: xem/hủy lịch khách không giới hạn giờ, xếp lịch HLV,
// tạo & quản trị tài khoản (3 tầng quyền).
function ManagementNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...tabBarOptions,
        tabBarIcon: ({ color }) => {
          const map = { Lich_khach: "calendar", Xep_lich: "sliders", Tai_khoan: "users", Ca_nhan: "user" };
          return <Feather name={map[route.name]} size={19} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Lich_khach" component={ManagementScheduleScreen} options={{ title: "Lịch khách" }} />
      <Tab.Screen name="Xep_lich" component={ScheduleBuilderScreen} options={{ title: "Xếp lịch HLV" }} />
      <Tab.Screen name="Tai_khoan" component={AccountsScreen} options={{ title: "Tài khoản" }} />
      <Tab.Screen name="Ca_nhan" component={ProfileScreen} options={{ title: "Cá nhân" }} />
    </Tab.Navigator>
  );
}

function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg }}>
        <ActivityIndicator color={COLORS.ink} size="large" />
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <StatusBar style="dark" />
        <LoginScreen />
      </SafeAreaView>
    );
  }

  const isManagement = user.role === "reception" || user.role === "admin";
  const isTrainer = user.role === "trainer";

  let Navigator = CustomerNavigator;
  if (isManagement) Navigator = ManagementNavigator;
  else if (isTrainer) Navigator = TrainerNavigator;

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Navigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
