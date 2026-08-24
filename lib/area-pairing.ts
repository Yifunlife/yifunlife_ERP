type MajorArea =
  | "职业体验 / Career Experience"
  | "生活场景 / Lifestyle Scene"
  | "农牧生活 / Agro-pastoral Life"
  | "动物世界 / Animal World"
  | "车生活 / Car Life"
  | "拼装手工 / Assemble by Hand";

export const pairedAreasByMajor: Record<MajorArea, string[]> = {
  "职业体验 / Career Experience": [
    "航空区", "警察区", "工地区", "消防区", "医院区", "未来医院区",
    "医院区（英文版）", "未来医院区（英文版）",
  ],
  "生活场景 / Lifestyle Scene": [
    "厨房区", "未来厨房区", "未来厨房区（英文版）", "超市区", "超市区（英文版）",
    "未来超市区", "未来超市区（英文版）", "熟食区", "烘焙区", "甜品区", "奶茶区",
    "火锅区", "烧烤区", "烤鸭区", "面馆区", "寿司区", "化妆区",
    "阅读区", "桌面游戏区", "洗衣房区", "BABY区", "育婴室区", "舞台区", "花店区",
  ],
  "农牧生活 / Agro-pastoral Life": [
    "牧场区", "母鸡生蛋区", "种植采摘区", "鱼池区",
  ],
  "动物世界 / Animal World": ["宠物医院区", "宠物之家区", "沐浴区", "恐龙区"],
  "车生活 / Car Life": ["赛车区", "修车区", "洗车区"],
  "拼装手工 / Assemble by Hand": ["排雷区", "沙池区", "积木区", "KTV区"],
};

export function pairedAreasForMajor(major: string) {
  if (major === "农牧生活 / 动物世界")
    return [
      ...pairedAreasByMajor["农牧生活 / Agro-pastoral Life"],
      ...pairedAreasByMajor["动物世界 / Animal World"],
    ];
  return pairedAreasByMajor[major as MajorArea] || [];
}

const canonicalPairedAreas = new Set(
  Object.values(pairedAreasByMajor).flat(),
);

const exactAreaMap: Record<string, string> = {
  航空区设备: "航空区",
  消防区设备: "消防区",
  消防站区域配套玩具: "消防区",
  警察局区域配套玩具: "警察区",
  医院区模拟设备: "医院区",
  医院区域配套玩具: "医院区",
  未来医院区域配套玩具: "未来医院区",
  医院区域英文版配套玩具: "医院区（英文版）",
  "未来医院区域配套玩具（英文版）": "未来医院区（英文版）",
  厨房区模拟设备: "厨房区",
  厨房区域配套玩具: "厨房区",
  未来厨房区模拟设备: "未来厨房区",
  未来厨房区域配套玩具: "未来厨房区",
  未来厨房区域英文版配套玩具: "未来厨房区（英文版）",
  超市区模拟设备: "超市区",
  超市区域配套玩具: "超市区",
  超市区域英文版配套玩具: "超市区（英文版）",
  未来超市区模拟设备: "未来超市区",
  未来超市区域配套玩具: "未来超市区",
  "未来超市区域英文版配套玩具": "未来超市区（英文版）",
  熟食区域配套玩具: "熟食区",
  烘焙区域配套玩具: "烘焙区",
  甜品屋区域配套玩具: "甜品区",
  奶茶区配套玩具: "奶茶区",
  化妆区模拟设备: "化妆区",
  公主房区: "化妆区",
  阅读区域配套玩具: "阅读区",
  桌面游戏区域配套玩具: "桌面游戏区",
  洗衣房区域配套玩具: "洗衣房区",
  BABY区域配套玩具: "BABY区",
  育婴室区域配套玩具: "育婴室区",
  舞台区域配套玩具: "舞台区",
  花店区域配套玩具: "花店区",
  牧场区域配套玩具: "牧场区",
  母鸡生蛋区域配套玩具: "母鸡生蛋区",
  种植采摘区域配套玩具: "种植采摘区",
  果蔬采摘区域配套玩具: "种植采摘区",
  果蔬采摘区: "种植采摘区",
  鱼池区域配套玩具: "鱼池区",
  恐龙区设备: "恐龙区",
  赛车区域配套玩具: "赛车区",
  修理店区域配套玩具: "修车区",
  洗车区: "洗车区",
  洗车区域配套玩具: "洗车区",
  排雷区设备: "排雷区",
  沙池区设备: "沙池区",
  沙池区域配套玩具: "沙池区",
};

const has = (text: string, words: RegExp) => words.test(text);

export function isPairableArea(sourceArea: string) {
  return sourceArea !== "(定制LOGO+0.27/双/定码定色/单码单色1000起，250双清箱)";
}

export function pairedArea(sourceArea: string, productName: string) {
  // 分类整理后，模拟设备与配套玩具会共同使用标准区域名。
  // 这些名称本身就是可配对区域，不应再回退到旧的来源分类规则。
  if (canonicalPairedAreas.has(sourceArea)) return sourceArea;
  if (exactAreaMap[sourceArea]) return exactAreaMap[sourceArea];
  const text = productName;

  if (sourceArea === "警察、工地设备")
    return has(text, /警察|警局|审讯|侦探|巡警/) ? "警察区" : "工地区";
  if (sourceArea === "工程、工地区域配套玩具") return "工地区";
  if (sourceArea === "火锅、烧烤、烤鸭、面馆区模拟设备") {
    if (has(text, /火锅/)) return "火锅区";
    if (has(text, /烧烤|烤串/)) return "烧烤区";
    if (has(text, /烤鸭/)) return "烤鸭区";
    return "面馆区";
  }
  if (sourceArea === "甜品、面包房、寿司区模拟设备") {
    if (has(text, /寿司/)) return "寿司区";
    if (has(text, /面包|烘焙/)) return "烘焙区";
    return "甜品区";
  }
  if (sourceArea === "公主房、化妆间区域配套玩具") return "化妆区";
  if (sourceArea === "牧场区") {
    if (has(text, /母鸡|鸡蛋/)) return "母鸡生蛋区";
    if (has(text, /种植|采摘/)) return "种植采摘区";
    if (has(text, /果蔬|蔬菜|水果/)) return "种植采摘区";
    if (has(text, /鱼|钓/)) return "鱼池区";
    return "牧场区";
  }
  if (sourceArea === "萌宠、沐浴区模拟设备")
    return has(text, /沐浴|洗澡|洗护/) ? "沐浴区" : "宠物之家区";
  if (sourceArea.startsWith("宠物医院、宠物之家区域配套玩具"))
    return has(text, /医院|医生|诊|医疗/) ? "宠物医院区" : "宠物之家区";
  if (sourceArea === "赛车、修车区模拟设备")
    return has(text, /修车|维修|修理|工具/) ? "修车区" : "赛车区";
  if (sourceArea === "积木、KTV设备")
    return has(text, /KTV|唱歌|麦克风/) ? "KTV区" : "积木区";
  if (sourceArea === "摩天轮、旋转木马、小火车设备") {
    if (has(text, /摩天轮/)) return "摩天轮区";
    if (has(text, /旋转木马|木马/)) return "旋转木马区";
    return "小火车区";
  }
  if (sourceArea === "小球运动与水科技")
    return has(text, /水|喷泉/) ? "水科技区" : "小球运动区";
  if (sourceArea === "多媒体互动类") return "多媒体互动区";
  if (sourceArea === "数字体育运动") return "数字体育区";
  if (sourceArea === "VR设备") return "VR区";
  if (sourceArea === "攀岩、运动区")
    return has(text, /攀岩|攀爬/) ? "攀岩区" : "运动区";
  return "";
}
