import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
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
import DashboardScreen from "./src/screens/DashboardScreen";
import { COLORS } from "./src/theme";

const Tab = createBottomTabNavigator();

// Thanh tab theo bản thiết kế 13 màn: CHỮ, không icon — tab đang chọn nằm trong chip màu nhạt
function TextTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = options.title ?? route.name;
        const focused = state.index === index;
        return (
          <TouchableOpacity
            key={route.key}
            activeOpacity={0.7}
            onPress={() => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={styles.tabItem}
          >
            <View style={[styles.tabChip, focused && { backgroundColor: COLORS.primaryTint }]}>
              <Text numberOfLines={1} style={[styles.tabLabel, { color: focused ? COLORS.primary : COLORS.tabInactive }]}>
                {label}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const navigatorProps = {
  screenOptions: { headerShown: false },
  tabBar: (props) => <TextTabBar {...props} />,
};

function CustomerNavigator() {
  return (
    <Tab.Navigator {...navigatorProps}>
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
    <Tab.Navigator {...navigatorProps}>
      <Tab.Screen name="Tong_quan" component={DashboardScreen} options={{ title: "Tổng quan" }} />
      <Tab.Screen name="Lich_khach" component={ManagementScheduleScreen} options={{ title: "Lịch dạy" }} />
      <Tab.Screen name="Ca_nhan" component={ProfileScreen} options={{ title: "Cá nhân" }} />
    </Tab.Navigator>
  );
}

// Lễ tân (reception) + admin: xem/hủy lịch khách không giới hạn giờ, xếp lịch HLV,
// tạo & quản trị tài khoản (3 tầng quyền).
// Bản thiết kế chỉ vẽ 4 tab — giữ thêm tab Cá nhân vì cần lối vào Cài đặt/Đăng xuất.
function ManagementNavigator() {
  // her-31: admin ĐÃ mở hồ sơ HLV có thêm tab "Lịch dạy" — xem lịch CỦA MÌNH như role HLV
  // (mở hồ sơ xong refreshMe cập nhật trainerId → tab tự hiện, không cần đăng nhập lại)
  const { user } = useAuth();
  const isAdminTrainer = user?.role === "admin" && !!user?.trainerId;
  return (
    <Tab.Navigator {...navigatorProps}>
      <Tab.Screen name="Tong_quan" component={DashboardScreen} options={{ title: "Tổng quan" }} />
      {/* her-21: gom Lịch khách + Xếp lịch thành 1 tab "Lịch tập" (chốt 16/08) */}
      <Tab.Screen name="Xep_lich" component={ScheduleBuilderScreen} options={{ title: "Lịch tập" }} />
      {isAdminTrainer && (
        <Tab.Screen name="Lich_day" component={ManagementScheduleScreen} options={{ title: "Lịch dạy" }} />
      )}
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
        <ActivityIndicator color={COLORS.primary} size="large" />
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

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
    paddingTop: 10,
    paddingHorizontal: 6,
  },
  tabItem: { flexShrink: 1, alignItems: "center" },
  tabChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  tabLabel: { fontSize: 11, fontWeight: "700" },
});
