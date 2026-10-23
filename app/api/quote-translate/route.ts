import { env } from "cloudflare:workers";
import { getLoginSession } from "../../../lib/auth";
type TranslationAI = { run(model: string, input: {text: string; source_lang: string; target_lang: string}): Promise<{translated_text?: string}> };
const terms: Record<string, string> = {
  "工艺做法": "Workmanship",
  "二步梯": "Two-step Stair Unit",
  "包装费（含部分产品特定包装箱）": "Packaging Fee (including product-specific crates for selected items)",
  "除甲醛": "Formaldehyde Removal",
  "运输费（含装货不含卸货）": "Transportation Fee (including loading; unloading excluded)",
  "安装费（含工人食宿）": "Installation Fee (including workers' meals and accommodation)",
  "USD200/天/人": "USD 200 per person per day",
  "小计（不含税）": "Subtotal (excluding tax)",
  "税额13%（可抵税）": "Tax at 13% (tax-deductible)",
  "总计（含税）": "Total (including tax)",
  "待补齐成本": "Cost Information Pending",
  "不够的情况下，请在此行以上插入新行": "If more rows are needed, insert them above this row.",
  "←左侧选择运输方式": "← Select the transportation method on the left",
  "←左侧选择安装方式": "← Select the installation method on the left",
  "金额<10万=5%10<金额<30=4.5%30<金额<50=4%50<金额<100=3.5%100<金额=3%": "Amount < 100,000: 5%\n10 < Amount < 30: 4.5%\n30 < Amount < 50: 4%\n50 < Amount < 100: 3.5%\n100 < Amount: 3%",
  "1、图片大小：宽2.5CM*高2.3CM2、字体：宋体，字号：123、单元格大小及位置勿随意改动4、行单元格不够时，直接插入，再用格式刷同步格式5、尺寸书写规则：长*宽*高6、设备-防护软包-吊挂/广告-地面-壁纸": "1. Image size: 2.5 cm wide × 2.3 cm high\n2. Font: SimSun, 12 pt\n3. Do not change cell sizes or positions arbitrarily.\n4. If more rows are needed, insert rows and use Format Painter to copy the formatting.\n5. Dimension order: Length × Width × Height\n6. Equipment – Protective Padding – Suspended Items / Signage – Flooring – Wallpaper",
  "1、图片大小：宽2.5CM*高2.3CM2、字体：宋体，字号：123、单元格大小及位置勿随意改动4、行单元格不够时，直接插入，再用格式刷同步格式5、尺寸书写规则：长*宽*高6、设备-防护软包-吊挂/广告-地面-壁纸7、修改时打开最顶部隐藏单元格可找到颜色标注底色": "1. Image size: 2.5 cm wide × 2.3 cm high\n2. Font: SimSun, 12 pt\n3. Do not change cell sizes or positions arbitrarily.\n4. If more rows are needed, insert rows and use Format Painter to copy the formatting.\n5. Dimension order: Length × Width × Height\n6. Equipment – Protective Padding – Suspended Items / Signage – Flooring – Wallpaper\n7. Unhide the cells at the top to find the colour codes used for revisions.",
  "材质/工艺做法仅内部知晓": "Materials / Workmanship\nInternal Use Only",
  "合计金额（大写）": "Total Amount in Words",
  "删除": "Delete", "新增": "Add", "修改数量/尺寸": "Revise Quantity / Dimensions", "客户自理": "By Customer",
  "若标准品请按核算表报价": "For standard products, quote according to the costing sheet.",
  "30000/时，含消毒": "30,000 balls/hour, including disinfection",
  "根据不同产品类型选择": "Select according to the product type",
  "国外需要": "Required for overseas orders",
  "海运费客户支付": "Ocean freight is payable by the customer",
  "USD200/天/人再加往返机票": "USD 200 per person per day, plus round-trip airfare",
  "内贸8%，外贸11%": "Domestic orders: 8%; overseas orders: 11%",
  "1.6m*0.8m*高1.585m": "1.6 m × 0.8 m × Height 1.585 m",
  "直径1.5*1高": "Diameter 1.5 m × Height 1 m",
  "此报价有效期为30天，超时将重新核算；以下为空白": "This quotation is valid for 30 days. Prices will be recalculated after expiry.\nThe remainder is intentionally blank.",
  "1、不含现场地面找平（C25水泥）、墙面找平、原始墙面批灰打磨、空调消防新风等；电源拉到现场（地产类）2、主要材料说明：皮革：环保B1阻燃木板：E0级环保B1阻燃海绵：英标B1阻燃油漆：大宝牌不锈钢：304食品级软垫：欧标壁纸：防潮、防霉、加厚、B1阻燃PVC：2MM厚高密度B1阻燃": "1. Excludes on-site floor levelling (C25 cement), wall levelling, puttying and sanding of existing walls, air conditioning, fire protection and fresh-air systems. Power must be brought to the site (property projects).\n2. Main materials:\nLeather: environmentally friendly, B1 flame-retardant\nWood panels: E0 environmental grade, B1 flame-retardant\nFoam: British standard, B1 flame-retardant\nPaint: Taiho brand\nStainless steel: food-grade 304\nPadding: European standard\nWallpaper: moisture-resistant, mould-resistant, thickened, B1 flame-retardant\nPVC: 2 mm thick, high-density, B1 flame-retardant",

  "亦玩集团+地区+品牌名&报价清单": "Yifun Life Group + Region + Brand & Quotation",
  "设计师：": "Designer:", "商务：": "Sales:", "色块填充": "Colour Fill",
  "墙面软包": "Wall Padding", "立柱软包": "Column Padding", "公共区软包": "Common Area Padding",
  "EVA软垫（阻燃）": "Flame-retardant EVA Mats", "地胶下软垫（阻燃）": "Flame-retardant Flooring Underlay",
  "PVC地胶": "PVC Flooring", "壁纸(阻燃)": "Flame-retardant Wallpaper", "广告字": "Signage Letters",
  "高配洗球机": "High-spec Ball Washing Machine", "国外工具箱": "Overseas Installation Tool Kit",
  "***区域玩法说明标识": "*** Area Play Instructions Sign", "公共区": "Common Area", "XX区": "XX Area",
  "周长*高": "Perimeter × Height", "1、以米为单位2、长*宽*高": "1. Dimensions in metres\n2. Length × Width × Height",
  "立体图案平面图案": "3D Pattern\nFlat Pattern", "是否发光？": "Illuminated?",
  "个": "Piece", "组": "Set", "项": "Item", "张": "Sheet", "平方": "Square Metres",
};

export async function POST(request: Request) {
  if (!await getLoginSession(request)) return Response.json({error: "请先登录"}, {status: 401});
  const body = await request.json() as {texts?: unknown};
  if (!Array.isArray(body.texts) || body.texts.length > 24 || body.texts.some(text => typeof text !== "string" || !text.trim() || text.length > 2000))
    return Response.json({error: "翻译内容无效，请每批提交不超过24段文字"}, {status: 400});
  const texts = body.texts as string[];
  const translations: Array<string | null> = [];
  try {
    for (let offset = 0; offset < texts.length; offset += 4) {
      translations.push(...await Promise.all(texts.slice(offset, offset + 4).map(async text => {
        try {
          const known = terms[text.replace(/\s+/g, "")];
          if (known) return known;
          if (/^品名\d+$/.test(text)) return `Product Name ${text.match(/\d+$/)![0]}`;
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
          const key = `quote-translations/en/${hash}`;
          const cached = await env.PRODUCT_IMAGES.get(key).catch(() => null);
          if (cached) {
            const english = (await cached.text()).trim();
            if (english && /[A-Za-z]/.test(english) && !/[\u4e00-\u9fff]/.test(english)) return english;
          }
          const result = await (env as unknown as {AI: TranslationAI}).AI.run("@cf/meta/m2m100-1.2b", {text, source_lang: "chinese", target_lang: "english"});
          const english = result.translated_text?.trim();
          if (!english || !/[A-Za-z]/.test(english) || /[\u4e00-\u9fff]/.test(english)) throw new Error("Incomplete translation");
          await env.PRODUCT_IMAGES.put(key, english).catch(() => {});
          return english;
        } catch { return null; }
      })));
    }
    const failedCount = translations.filter(text => !text).length;
    if (failedCount) return Response.json({ translations, failedCount, error: "部分文字未能完成英文翻译，已保留原文。" }, { status: failedCount === texts.length ? 503 : 200 });
    return Response.json({translations});
  } catch {
    return Response.json({error: "自动翻译暂未完成，请稍后重新导入；原表内容未修改"}, {status: 503});
  }
}
