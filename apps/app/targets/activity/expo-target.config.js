/** @type {import("@bacons/apple-targets/app.plugin").Config} */
module.exports = {
    type: "widget",
    name: "LingerActivity",
    displayName: "LingerCam",
    bundleIdentifier: ".activity",
    deploymentTarget: "16.4",
    frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
};
