import type { OcrFileType, OcrResult } from "./types";

const RECOGNIZED_TEXT = [
  "\u9879\u76ee\u540d\u79f0\uff1a2025\u5e74\u4e2d\u836f\u996e\u7247\u91c7\u8d2d\u9879\u76ee",
  "\u9879\u76ee\u7f16\u53f7\uff1aCG-2025-001",
  "\u91c7\u8d2d\u65b9\u5f0f\uff1a\u516c\u5f00\u62db\u6807",
  "\u91c7\u8d2d\u4eba\uff1a\u67d0\u67d0\u533b\u9662",
  "\u91c7\u8d2d\u516c\u544a\u5df2\u53d1\u5e03\uff0c\u4f9b\u5e94\u5546\u9700\u57282025\u5e746\u67081\u65e5\u524d\u5b8c\u6210\u62a5\u540d\u3002",
  "\u672c\u9879\u76ee\u5f00\u6807\u65f6\u95f4\u4e3a2025\u5e746\u670810\u65e5\u3002",
  "\u672c\u6750\u6599\u5305\u542b\u91c7\u8d2d\u6587\u4ef6\u3001\u91c7\u8d2d\u516c\u544a\u3001\u62a5\u540d\u4fe1\u606f\u548c\u5f00\u6807\u5b89\u6392\u3002",
  "\u6682\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0\u9875\u3002"
].join("\n");

export function mockOcr(fileName: string, fileType: OcrFileType): OcrResult {
  return {
    ocr_id: "ocr_demo_001",
    source_file: {
      file_name: fileName || "\u91c7\u8d2d\u516c\u544a\u626b\u63cf\u4ef6.pdf",
      file_type: fileType,
      page_count: 1
    },
    recognized_text: RECOGNIZED_TEXT,
    detected_material_type: "\u91c7\u8d2d\u516c\u544a",
    confidence: 0.91,
    layout_blocks: [
      {
        block_type: "title",
        text: "2025\u5e74\u4e2d\u836f\u996e\u7247\u91c7\u8d2d\u9879\u76ee\u91c7\u8d2d\u516c\u544a",
        page: 1
      },
      {
        block_type: "key_value",
        text: "\u9879\u76ee\u7f16\u53f7\uff1aCG-2025-001",
        page: 1
      }
    ],
    warnings: [
      {
        type: "mock_only",
        message: "\u5f53\u524d\u7248\u672c\u4e3a mock OCR \u7ed3\u679c\uff0c\u5c1a\u672a\u63a5\u5165\u771f\u5b9e OCR\u3002"
      },
      {
        type: "seal_uncertain",
        message: "\u5f53\u524d\u7248\u672c\u672a\u8fdb\u884c\u771f\u5b9e\u7b7e\u7ae0\u56fe\u50cf\u8bc6\u522b\uff0c\u7b7e\u5b57\u76d6\u7ae0\u60c5\u51b5\u9700\u4eba\u5de5\u590d\u6838\u3002"
      }
    ],
    source: "ocr_pending"
  };
}
