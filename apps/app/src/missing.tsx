import { useRouter, type Href } from "expo-router";
import { StyleSheet, View } from "react-native";

import { t } from "@/copy";
import { Button, Screen, Text, Wordmark } from "@/ui";

/** An address that isn't a screen or a join code. */
export function MissingScreen() {
    const router = useRouter();
    return (
        <Screen>
            <View style={styles.body}>
                <Wordmark size={34} />
                <Text
                    variant="title"
                    align="center"
                    accessibilityRole="header"
                    style={{ marginTop: 32 }}
                >
                    {t("web.notFoundTitle")}
                </Text>
                <Button
                    label={t("web.notFoundLink")}
                    onPress={() => router.replace("/" as Href)}
                    style={styles.action}
                />
            </View>
        </Screen>
    );
}

const styles = StyleSheet.create({
    body: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        maxWidth: 440,
        alignSelf: "center",
    },
    action: { marginTop: 28, alignSelf: "stretch" },
});
