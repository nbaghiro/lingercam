// Sample photos the camera uses where there is no camera, such as the iOS simulator. They are
// required only in development, so release builds don't carry them.
export const DEMO_PHOTOS: readonly number[] = __DEV__
    ? [
          require("../assets/demo/w-dog.jpg"),
          require("../assets/demo/b-cake.jpg"),
          require("../assets/demo/p-cheer.jpg"),
          require("../assets/demo/t-drive.jpg"),
          require("../assets/demo/w-toast.jpg"),
          require("../assets/demo/e-couple.jpg"),
          require("../assets/demo/w-dance.jpg"),
          require("../assets/demo/p-group.jpg"),
          require("../assets/demo/b-laugh.jpg"),
          require("../assets/demo/t-van.jpg"),
          require("../assets/demo/w-clink.jpg"),
          require("../assets/demo/p-hug.jpg"),
      ]
    : [];
