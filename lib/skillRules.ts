export const filingKeywords = [
  "\u91c7\u8d2d\u6587\u4ef6",
  "\u91c7\u8d2d\u516c\u544a",
  "\u62a5\u540d\u8868",
  "\u4e2d\u6807\u901a\u77e5\u4e66",
  "\u7b7e\u5b57\u76d6\u7ae0",
  "\u5f52\u6863",
  "\u5907\u6848",
  "\u62db\u6807\u6587\u4ef6",
  "\u62a5\u540d"
];

export const bidEvaluationKeywords = [
  "\u5f00\u6807",
  "\u8bc4\u6807",
  "\u8bc4\u5206",
  "\u4f9b\u5e94\u5546",
  "\u62a5\u4ef7",
  "\u6295\u6807\u5355\u4f4d",
  "\u8d44\u683c\u5ba1\u67e5",
  "\u8bc4\u5ba1\u5f97\u5206",
  "\u6295\u6807\u4eba"
];

export const materialTypeRules = [
  { type: "招标文件", keywords: ["招标文件"] },
  { type: "竞争性磋商文件", keywords: ["磋商文件", "竞争性磋商文件"] },
  { type: "\u91c7\u8d2d\u516c\u544a", keywords: ["\u91c7\u8d2d\u516c\u544a", "\u516c\u544a", "\u62a5\u540d"] },
  { type: "\u91c7\u8d2d\u6587\u4ef6", keywords: ["\u91c7\u8d2d\u6587\u4ef6"] },
  { type: "\u5f00\u6807\u8bb0\u5f55", keywords: ["\u5f00\u6807", "\u5f00\u6807\u8bb0\u5f55"] },
  { type: "\u8bc4\u6807\u8d44\u6599", keywords: ["\u8bc4\u6807", "\u8bc4\u5206", "\u8bc4\u5ba1\u5f97\u5206", "\u8d44\u683c\u5ba1\u67e5"] },
  { type: "\u4e2d\u6807\u7ed3\u679c\u6750\u6599", keywords: ["\u4e2d\u6807\u901a\u77e5\u4e66", "\u4e2d\u6807"] },
  { type: "\u7b7e\u5b57\u76d6\u7ae0\u6587\u4ef6", keywords: ["\u7b7e\u5b57", "\u76d6\u7ae0", "\u516c\u7ae0"] }
];

export const filingTemplateDirectory = [
  {
    template_position: "\u4e00\u3001\u91c7\u8d2d\u6587\u4ef6",
    required_material: "\u91c7\u8d2d\u6587\u4ef6/\u62db\u6807\u6587\u4ef6",
    keywords: ["\u91c7\u8d2d\u6587\u4ef6", "\u62db\u6807\u6587\u4ef6"]
  },
  {
    template_position: "\u4e8c\u3001\u91c7\u8d2d\u516c\u544a",
    required_material: "\u91c7\u8d2d\u516c\u544a",
    keywords: ["\u91c7\u8d2d\u516c\u544a", "\u516c\u544a"]
  },
  {
    template_position: "\u4e09\u3001\u62a5\u540d\u8d44\u6599",
    required_material: "\u62a5\u540d\u8868/\u62a5\u540d\u8d44\u6599",
    keywords: ["\u62a5\u540d\u8868", "\u62a5\u540d", "\u4f9b\u5e94\u5546"]
  },
  {
    template_position: "\u56db\u3001\u5f00\u6807\u8bb0\u5f55",
    required_material: "\u5f00\u6807\u8bb0\u5f55\u8868",
    keywords: ["\u5f00\u6807\u8bb0\u5f55\u8868", "\u5f00\u6807"]
  },
  {
    template_position: "\u4e94\u3001\u8bc4\u6807\u8d44\u6599",
    required_material: "\u8bc4\u6807\u62a5\u544a/\u8bc4\u5206\u8868/\u8d44\u683c\u5ba1\u67e5\u6750\u6599",
    keywords: ["\u8bc4\u6807\u62a5\u544a", "\u8bc4\u6807", "\u8bc4\u5206", "\u8d44\u683c\u5ba1\u67e5"]
  },
  {
    template_position: "\u516d\u3001\u4e2d\u6807\u7ed3\u679c\u6750\u6599",
    required_material: "\u4e2d\u6807\u901a\u77e5\u4e66/\u4e2d\u6807\u7ed3\u679c",
    keywords: ["\u4e2d\u6807\u901a\u77e5\u4e66", "\u4e2d\u6807"]
  },
  {
    template_position: "\u4e03\u3001\u7b7e\u5b57\u76d6\u7ae0\u6587\u4ef6",
    required_material: "\u7b7e\u5b57\u76d6\u7ae0\u6587\u4ef6",
    keywords: ["\u7b7e\u5b57", "\u76d6\u7ae0", "\u516c\u7ae0"]
  },
  {
    template_position: "\u516b\u3001\u5f52\u6863\u5c01\u9762\u4e0e\u76ee\u5f55",
    required_material: "\u5f52\u6863\u5c01\u9762\u4e0e\u76ee\u5f55",
    keywords: ["\u5f52\u6863", "\u76ee\u5f55", "\u5c01\u9762"]
  }
];
