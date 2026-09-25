import "dotenv/config";
import { createApp } from "./app.js";
import { createVisionAdapterFromEnv } from "./openai-vision.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const app = createApp({ visionAdapter: createVisionAdapterFromEnv() });

app.listen(port, "127.0.0.1", () => {
  console.log(`图证服务端已启动：http://127.0.0.1:${port}`);
});
