import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

/* One address, same as the Worker's HOME redirect: a check-in code is signed
   against the origin that asked for it, so the shell must not open a preview
   host. EXPO_PUBLIC_WERUN_URL in mobile/.env points it at tools/dev.js instead;
   with no .env it is production, which is what a fresh clone should get. */
const HOME = process.env.EXPO_PUBLIC_WERUN_URL || "https://weruncoaching.pages.dev";
const START = HOME.replace(/\/$/, "") + "/app";
const BG = "#0b0b0f";

export default function App() {
  const web = useRef(null);
  const canGoBack = useRef(false);
  const [failed, setFailed] = useState(false);

  // The scanner asks for the camera and the check-in asks for GPS through the
  // page's own web APIs; on Android the WebView only grants what the app holds.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]).catch(() => {});
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const reload = useCallback(() => {
    setFailed(false);
    web.current?.reload();
  }, []);

  return (
    <SafeAreaView style={styles.fill}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      {failed ? (
        <View style={[styles.fill, styles.center]}>
          <Text style={styles.msg}>Can’t reach weruncoaching.pages.dev</Text>
          <Pressable style={styles.btn} onPress={reload}>
            <Text style={styles.btnText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          ref={web}
          source={{ uri: START }}
          style={styles.fill}
          // Stripe checkout and the Strava OAuth hand-off leave the origin and
          // come back, so http(s) stays in here; only mailto:/tel:/app links go out.
          originWhitelist={["http://*", "https://*"]}
          onShouldStartLoadWithRequest={(r) => /^https?:/.test(r.url)}
          onNavigationStateChange={(s) => {
            canGoBack.current = s.canGoBack;
          }}
          onError={() => setFailed(true)}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 500) setFailed(true);
          }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantStatus="grant"
          geolocationEnabled
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.fill, styles.center]}>
              <ActivityIndicator color="#8851F4" />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  center: { alignItems: "center", justifyContent: "center" },
  msg: { color: "#e8e8ef", fontSize: 16, marginBottom: 16 },
  btn: { backgroundColor: "#8851F4", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
