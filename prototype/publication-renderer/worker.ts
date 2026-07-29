import { renderPublication } from "../../src/articles/publication-renderer.server";

export default {
  async fetch(): Promise<Response> {
    const result = await renderPublication(
      {
        documentSchemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "workerd bundle proof" }],
            },
            {
              type: "figure",
              attrs: {
                assetId: "asset-proof",
                alt: "Runtime proof",
                decorative: false,
              },
            },
            {
              type: "videoEmbed",
              attrs: {
                provider: "youtube",
                id: "dQw4w9WgXcQ",
                title: "Runtime proof",
              },
            },
          ],
        },
      },
      {
        resolveAsset: async (assetId) => ({
          assetId,
          publicUrl: "https://media.example.com/assets/proof.webp",
          width: 1_200,
          height: 800,
        }),
      },
    );

    return Response.json({
      runtime: {
        userAgent: navigator.userAgent,
        hasDocument: "document" in globalThis,
        hasDomParser: "DOMParser" in globalThis,
      },
      result,
    });
  },
};
