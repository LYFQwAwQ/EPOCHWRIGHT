import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          minSize: 20_000,
          groups: [
            {
              name: "three-vendor",
              test: /node_modules[\\/]three[\\/]/,
            },
            {
              name: "react-three-vendor",
              test: /node_modules[\\/](@react-three|camera-controls)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
