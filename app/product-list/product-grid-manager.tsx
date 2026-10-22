"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CellValueChangedEvent,
  ColDef,
  ICellEditorParams,
  ICellRendererParams,
  SelectionChangedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { CatalogProduct } from "../catalog-types";
import { pairedArea } from "../../lib/area-pairing";

type Override = {
  productId: string;
  name?: string | null;
  price?: string | number | null;
  imageUrl?: string | null;
  specification?: string | null;
  unit?: string | null;
  cost?: number | null;
  branchPrice?: number | null;
  supplyMethod?: string | null;
  stock?: number | null;
  majorCategory?: string | null;
  category1?: string | null;
  category2?: string | null;
  category3?: string | null;
  colorTag?: string | null;
};

type ProductClassification = {
  id: string;
  productId: string;
  level1: string;
  level2: string;
  level3: string;
};

type ProductTag = { productId: string; tag: string };

type Category = {
  level: number;
  parentKey: string;
  name: string;
};

type ProductRelation = {
  productId: string;
  relatedProductId: string;
  quantity?: number | string;
};

type GridRow = {
  rowId: string;
  id: string;
  image: string;
  sku: string;
  productName: string;
  level1: string;
  category1: string;
  category2: string;
  category3: string;
  categoryPath: string;
  productType: string;
  tags: string;
  colorTag: string;
  price: number | null;
  cost: number | null;
  branchPrice: number | null;
  specification: string;
  unit: string;
  supplyMethod: string;
  stock: number | null;
  note: string;
  name: string;
  en: string;
};

type UndoItem = {
  productId: string;
  sku: string;
  patch: Record<string, unknown>;
  restoreRow: GridRow;
};

type UndoChange = {
  label: string;
  items: UndoItem[];
};

const colorChoices = [
  "不适用",
  "红",
  "粉",
  "黄",
  "蓝",
  "黑",
  "白",
  "银色",
  "橙",
  "绿",
  "紫",
  "待重新识别",
  "未识别",
  "无主图",
];

const colorSwatches: Record<string, string> = {
  红: "#d83d48", 粉: "#ef9a9a", 黄: "#ddbd26", 蓝: "#2f7eb9",
  黑: "#1c242d", 白: "#ffffff", 银色: "#b9bec4", 橙: "#e9812f",
  绿: "#3f9862", 紫: "#8756b6", 不适用: "#b9c3bd",
  待重新识别: "#d7b55f", 未识别: "#d7b55f", 无主图: "#c9cfca",
};

const primaryCategoryChoices = ["模拟设备", "配套产品"];
const productTypeChoices = ["主设备", "配套产品", "配套玩具", "广告类型", "地面/地胶"];
const supplyMethodChoices = ["自有生产", "外采"];

function ColourDot({ value }: { value: string }) {
  return (
    <span
      className="gridColourDot"
      style={{ background: colorSwatches[value] || "#b9c3bd" }}
      aria-hidden="true"
    />
  );
}

type PickerEditorProps = ICellEditorParams<GridRow, string> & {
  values: string[];
  showColour?: boolean;
};

const PickerEditor = forwardRef<{ getValue: () => string }, PickerEditorProps>(
  ({ value, values, showColour, stopEditing }, ref) => {
    const selected = useRef(String(value || ""));
    useImperativeHandle(ref, () => ({ getValue: () => selected.current }));
    return (
      <div className="gridPicker" role="listbox">
        {values.map((option) => (
          <button
            className={option === selected.current ? "selected" : ""}
            key={option}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              selected.current = option;
              stopEditing();
            }}
            type="button"
          >
            {showColour && <ColourDot value={option} />}
            <span>{option}</span>
          </button>
        ))}
      </div>
    );
  },
);
PickerEditor.displayName = "PickerEditor";

const categoryPath = (level1: string, level2: string, level3: string) =>
  [level1, level2, level3].filter(Boolean).join(" / ");

const pairingAreaForRow = (row: GridRow) =>
  pairedArea(row.category2, row.productName) || row.category2;

const isPairingItem = (row: GridRow) =>
  row.productType === "配套产品" || row.productType === "配套玩具";
const isAccessoryProductName = (name: string) =>
  /凳|椅|衣架|挂钩|购物车|购物篮/.test(name);

const normalizedRelation = (relation: ProductRelation): ProductRelation => ({
  ...relation,
  quantity: Math.max(1, Math.floor(Number(relation.quantity) || 1)),
});

const relationQuantityTotal = (relations: ProductRelation[]) =>
  relations.reduce(
    (total, relation) => total + Math.max(1, Math.floor(Number(relation.quantity) || 1)),
    0,
  );

const splitTags = (value: string) =>
  [...new Set(value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean))];

const gridRows = (
  products: CatalogProduct[],
  overrides: Override[],
  classifications: ProductClassification[],
  tags: ProductTag[],
): GridRow[] => {
  const overrideById = new Map(overrides.map((override) => [override.productId, override]));
  const classificationsByProduct = new Map<string, ProductClassification[]>();
  classifications.forEach((record) => {
    const current = classificationsByProduct.get(record.productId) || [];
    current.push(record);
    classificationsByProduct.set(record.productId, current);
  });
  const tagsByProduct = new Map<string, string[]>();
  tags.forEach((record) => {
    const current = tagsByProduct.get(record.productId) || [];
    current.push(record.tag);
    tagsByProduct.set(record.productId, current);
  });
  return products.flatMap((product) => {
    const override = overrideById.get(product.id);
    const fallbackLevel2 =
      override?.category1 ||
      (product.family === "小玩具" ? "配套产品" : "模拟设备");
    const productTags = tagsByProduct.get(product.id) || [
      override?.category3 ||
      (product.family === "小玩具"
        ? "配套玩具"
        : isAccessoryProductName(override?.name || product.name)
          ? "配套产品"
          : "主设备"),
    ];
    const productType =
      productTags.find((tag) => productTypeChoices.includes(tag)) || productTags[0] || "";
    const records = classificationsByProduct.get(product.id) || [{
      id: `classification-${product.id}`,
      productId: product.id,
      level1: override?.majorCategory || "生活场景 / Lifestyle Scene",
      level2: fallbackLevel2,
      level3: override?.category2 || product.category || "未分类",
    }];
    return records.map((record) => ({
      rowId: record.id,
      id: product.id,
      image: override?.imageUrl || product.image,
      sku: product.sku,
      productName: override?.name || product.name,
      level1: record.level1,
      category1: record.level2,
      category2: record.level3,
      category3: productType,
      categoryPath: categoryPath(record.level1, record.level2, record.level3),
      productType,
      tags: productTags.join("、"),
      colorTag:
        productType === "配套玩具"
          ? "不适用"
          : override?.colorTag || (product.image ? "待重新识别" : "无主图"),
      price:
        override?.price === undefined || override.price === null || override.price === ""
            ? product.price
            : Number(override.price),
      cost: override?.cost ?? null,
      branchPrice: override?.branchPrice ?? null,
      specification: override?.specification ?? product.spec,
      unit: override?.unit ?? product.unit,
      supplyMethod: override?.supplyMethod || "",
      stock: override?.stock ?? null,
      note: product.note || product.priceNote,
      name: override?.name || product.name,
      en: product.en,
    }));
  });
};

export function ProductGridManager({
  pairingStandalone = false,
}: {
  pairingStandalone?: boolean;
}) {
  const [rows, setRows] = useState<GridRow[]>([]);
  const [adminAccess, setAdminAccess] = useState<
    "checking" | "granted" | "denied"
  >("checking");
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("正在加载产品清单…");
  const [undoStack, setUndoStack] = useState<UndoChange[]>([]);
  const [selectedRows, setSelectedRows] = useState<GridRow[]>([]);
  const [batchLevel1, setBatchLevel1] = useState("");
  const [batchCategory1, setBatchCategory1] = useState("");
  const [batchCategory2, setBatchCategory2] = useState("");
  const [batchTags, setBatchTags] = useState("");
  const [directoryFilter, setDirectoryFilter] = useState<{
    level1?: string;
    level2?: string;
    level3?: string;
  }>({});
  const [relations, setRelations] = useState<ProductRelation[]>([]);
  const pairingOpen = pairingStandalone;
  const [pairingCategory, setPairingCategory] = useState("");
  const [pairingSourceId, setPairingSourceId] = useState("");
  const [pairingTargetIds, setPairingTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const [pairingQuantities, setPairingQuantities] = useState<Record<string, number>>({});
  const [pairingMatrix, setPairingMatrix] = useState<
    Record<string, Record<string, number>>
  >({});
  const [pairingSearch, setPairingSearch] = useState("");
  const [pairingSaving, setPairingSaving] = useState(false);
  const [pairingClearing, setPairingClearing] = useState(false);
  const [pairingSavedMessage, setPairingSavedMessage] = useState("");
  const pairingPinnedRowsRef = useRef<HTMLDivElement>(null);
  const pairingMatrixWrapRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const sessionResponse = await fetch("/api/auth/session");
    const session = await sessionResponse.json().catch(() => ({}));
    if (!session.authenticated || session.role !== "admin") {
      setAdminAccess("denied");
      setStatus("产品清单与玩具配对仅限管理员使用。");
      return;
    }
    setAdminAccess("granted");
    const response = await fetch("/api/catalog");
    if (!response.ok) {
      setStatus("无法加载产品清单，请返回主页面重新登录。");
      return;
    }
    const data = await response.json();
    setRows(gridRows(
      data.products || [],
      data.overrides || [],
      data.classifications || [],
      data.tags || [],
    ));
    setCategories(data.categories || []);
    setRelations((data.recommendations || []).map(normalizedRelation));
    setStatus(`${(data.products || []).length} 个 SKU · ${(data.classifications || []).length} 条分类记录`);
  };

  useEffect(() => {
    void load();
  }, []);

  const batchLevel1Options = useMemo(
    () => [...new Set(rows.map((row) => row.level1).filter(Boolean))].sort(),
    [rows],
  );
  const batchCategory1Options = useMemo(
    () => [...new Set([...primaryCategoryChoices, ...rows.map((row) => row.category1)])].sort(),
    [rows],
  );
  const batchCategory2Options = useMemo(
    () =>
      [...new Set([
        ...rows.map((row) => row.category2),
        ...categories
          .filter((category) => category.level === 2)
          .map((category) => category.name),
      ])].sort(),
    [categories, rows],
  );
  const directoryTree = useMemo(() => {
    const tree = new Map<string, Map<string, Set<string>>>();
    rows.forEach((row) => {
      if (!tree.has(row.level1)) tree.set(row.level1, new Map());
      const second = tree.get(row.level1)!;
      if (!second.has(row.category1)) second.set(row.category1, new Set());
      second.get(row.category1)!.add(row.category2);
    });
    return tree;
  }, [rows]);
  const displayedRows = useMemo(
    () => rows.filter((row) =>
      (!directoryFilter.level1 || row.level1 === directoryFilter.level1) &&
      (!directoryFilter.level2 || row.category1 === directoryFilter.level2) &&
      (!directoryFilter.level3 || row.category2 === directoryFilter.level3)),
    [directoryFilter, rows],
  );

  const pairingToyAreas = useMemo(
    () => new Set(
      rows
        .filter(isPairingItem)
        .map(pairingAreaForRow),
    ),
    [rows],
  );
  const simulationCategories = useMemo(
    () =>
      [...new Set(
        rows
          .filter(
            (row) =>
              row.productType === "主设备" &&
              pairingToyAreas.has(pairingAreaForRow(row)),
          )
          .map(pairingAreaForRow),
      )].sort(),
    [pairingToyAreas, rows],
  );
  const pairingAreaSimulationRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.productType === "主设备" &&
          pairingToyAreas.has(pairingAreaForRow(row)) &&
          pairingAreaForRow(row) === pairingCategory,
      ),
    [pairingCategory, pairingToyAreas, rows],
  );
  const pairingSimulationRows = useMemo(() => {
    const query = pairingSearch.trim().toLowerCase();
    return query
      ? pairingAreaSimulationRows.filter((row) =>
          `${row.productName} ${row.en} ${row.sku}`
            .toLowerCase()
            .includes(query),
        )
      : pairingAreaSimulationRows;
  }, [pairingAreaSimulationRows, pairingSearch]);
  const pairingToyRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          isPairingItem(row) &&
          pairingAreaForRow(row) === pairingCategory,
      ),
    [pairingCategory, rows],
  );
  const pairingCountsBySourceId = useMemo(() => {
    const counts = new Map<string, number>();
    relations.forEach((relation) => {
      counts.set(relation.productId, (counts.get(relation.productId) || 0) + 1);
    });
    return counts;
  }, [relations]);
  const selectedToyQuantity = useMemo(
    () =>
      [...pairingTargetIds].reduce(
        (total, productId) => total + (pairingQuantities[productId] || 1),
        0,
      ),
    [pairingQuantities, pairingTargetIds],
  );
  useEffect(() => {
    if (pairingStandalone && !pairingCategory && simulationCategories.length)
      setPairingCategory(simulationCategories[0]);
  }, [pairingCategory, pairingStandalone, simulationCategories]);

  useEffect(() => {
    const sourceIds = new Set(pairingAreaSimulationRows.map((row) => row.id));
    const toyIds = new Set(pairingToyRows.map((row) => row.id));
    const next = Object.fromEntries(
      pairingAreaSimulationRows.map((row) => [row.id, {}]),
    ) as Record<string, Record<string, number>>;
    relations.forEach((relation) => {
      if (!sourceIds.has(relation.productId) || !toyIds.has(relation.relatedProductId))
        return;
      next[relation.productId][relation.relatedProductId] =
        Math.max(1, Math.floor(Number(relation.quantity) || 1));
    });
    setPairingMatrix(next);
  }, [pairingAreaSimulationRows, pairingToyRows, relations]);

  const closePairingManager = () => {
    window.location.assign("/");
  };

  const selectPairingSource = (productId: string) => {
    const savedRelations = relations.filter(
      (relation) => relation.productId === productId,
    );
    setPairingSourceId(productId);
    setPairingTargetIds(
      new Set(
        savedRelations.map((relation) => relation.relatedProductId),
      ),
    );
    setPairingQuantities(
      Object.fromEntries(
        savedRelations.map((relation) => [
          relation.relatedProductId,
          Number(relation.quantity) || 1,
        ]),
      ),
    );
    setPairingSavedMessage(
      savedRelations.length
        ? `已载入 ${savedRelations.length} 个已保存配套玩具，总数量 ${relationQuantityTotal(savedRelations)}。`
        : "该模拟产品暂未保存配套玩具。",
    );
  };

  const togglePairingTarget = (productId: string) => {
    setPairingTargetIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setPairingQuantities((current) => {
      const next = { ...current };
      if (next[productId]) delete next[productId];
      else next[productId] = 1;
      return next;
    });
  };

  const setPairingQuantity = (productId: string, value: number) => {
    const quantity = Math.max(0, Math.floor(Number(value) || 0));
    setPairingTargetIds((current) => {
      const next = new Set(current);
      if (quantity) next.add(productId);
      else next.delete(productId);
      return next;
    });
    setPairingQuantities((current) => {
      const next = { ...current };
      if (quantity) next[productId] = quantity;
      else delete next[productId];
      return next;
    });
  };

  const setMatrixQuantity = (
    sourceId: string,
    toyId: string,
    value: number,
  ) => {
    const quantity = Math.max(0, Math.floor(Number(value) || 0));
    setPairingMatrix((current) => ({
      ...current,
      [sourceId]: {
        ...(current[sourceId] || {}),
        [toyId]: quantity,
      },
    }));
  };

  const savePairingMatrix = async () => {
    setPairingSaving(true);
    setPairingSavedMessage("");
    const sources = pairingAreaSimulationRows;
    const payloads = sources.map((source) => {
      const relatedProducts = pairingToyRows
        .map((toy) => ({
          relatedProductId: toy.id,
          quantity: pairingMatrix[source.id]?.[toy.id] || 0,
        }))
        .filter((item) => item.quantity > 0);
      return { productId: source.id, relatedProducts };
    });
    const responses: Response[] = [];
    for (let index = 0; index < payloads.length; index += 5) {
      const batch = await Promise.all(
        payloads.slice(index, index + 5).map((payload) =>
          fetch("/api/catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "recommendations", ...payload }),
          }),
        ),
      );
      responses.push(...batch);
      if (batch.some((response) => !response.ok)) break;
    }
    setPairingSaving(false);
    if (responses.some((response) => !response.ok) || responses.length !== sources.length) {
      setPairingSavedMessage("配对表保存失败，请重试。");
      return;
    }
    await load();
    const total = sources.reduce(
      (sum, source) =>
        sum +
        pairingToyRows.reduce(
          (rowTotal, toy) =>
            rowTotal + (pairingMatrix[source.id]?.[toy.id] || 0),
          0,
        ),
      0,
    );
    setPairingSavedMessage(
      `已保存 ${sources.length} 台模拟设备的配对表，共 ${total} 件配套项目。`,
    );
  };

  const clearPairingMatrix = () => {
    setPairingMatrix(
      Object.fromEntries(
        pairingAreaSimulationRows.map((row) => [row.id, {}]),
      ),
    );
    setPairingSavedMessage("已清空当前表格，请点击“保存配对表”后生效。");
  };

  const savePairing = async () => {
    if (!pairingSourceId) return;
    setPairingSaving(true);
    const response = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "recommendations",
        productId: pairingSourceId,
        relatedProducts: [...pairingTargetIds].map((relatedProductId) => ({
          relatedProductId,
          quantity: pairingQuantities[relatedProductId] || 1,
        })),
      }),
    });
    if (!response.ok) {
      setPairingSaving(false);
      setStatus("配对保存失败，请重试。");
      return;
    }
    const data = (await response.json()) as {
      recommendations?: ProductRelation[];
    };
    const savedRelations = (data.recommendations || []).map(normalizedRelation);
    setPairingSaving(false);
    setRelations((current) => [
      ...current.filter((relation) => relation.productId !== pairingSourceId),
      ...savedRelations,
    ]);
    const savedQuantity = relationQuantityTotal(savedRelations);
    setStatus(`已保存 ${savedRelations.length} 个配套玩具 · 总数量 ${savedQuantity}`);
    setPairingSavedMessage(
      `已保存 ${savedRelations.length} 个配套玩具，总数量 ${savedQuantity}。窗口会保持打开，方便你立即核对。`,
    );
  };

  const clearPairing = async () => {
    if (!pairingSourceId) return;
    const source = rows.find((row) => row.id === pairingSourceId);
    setPairingClearing(true);
    const response = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "recommendations",
        productId: pairingSourceId,
        relatedProducts: [],
      }),
    });
    setPairingClearing(false);
    if (!response.ok) {
      setPairingSavedMessage("清除配对失败，请重试。");
      return;
    }
    setRelations((current) =>
      current.filter((relation) => relation.productId !== pairingSourceId),
    );
    setPairingTargetIds(new Set());
    setPairingQuantities({});
    setStatus(`已清除 ${source?.sku || "当前设备"} 的配套玩具`);
    setPairingSavedMessage(
      `已清除 ${source?.sku || "当前设备"} 所配对的全部玩具。`,
    );
  };

  const persistProductStructure = async (
    productId: string,
    nextRows: GridRow[],
    tagsText: string,
  ) =>
    fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "classifications",
        productId,
        classifications: nextRows
          .filter((row) => row.level1 && row.category1 && row.category2)
          .map((row) => ({
            id: row.rowId,
            level1: row.level1,
            level2: row.category1,
            level3: row.category2,
          })),
        tags: splitTags(tagsText),
      }),
    });

  const saveChange = async (event: CellValueChangedEvent<GridRow>) => {
    if (!event.data || event.newValue === event.oldValue) return;
    const field = event.colDef.field;
    if (field === "level1" || field === "category1" || field === "category2" || field === "tags") {
      const previousRows = rows.filter((row) => row.id === event.data.id);
      const newValue = String(event.newValue || "").trim();
      const nextRows = previousRows.map((row) => {
        if (field === "tags")
          return {
            ...row,
            tags: splitTags(newValue).join("、"),
            productType:
              splitTags(newValue).find((tag) => productTypeChoices.includes(tag)) || "",
          };
        if (row.rowId !== event.data.rowId) return row;
        const next = { ...row, [field]: newValue };
        return {
          ...next,
          categoryPath: categoryPath(next.level1, next.category1, next.category2),
        };
      });
      if (!nextRows.some((row) => row.level1 && row.category1 && row.category2)) {
        setStatus(`${event.data.sku} 至少需要一条完整分类记录。`);
        setRows((current) => [
          ...current.filter((row) => row.id !== event.data.id),
          ...previousRows,
        ]);
        return;
      }
      setRows((current) => [
        ...current.filter((row) => row.id !== event.data.id),
        ...nextRows,
      ]);
      setStatus(`正在保存 ${event.data.sku} 的分类记录…`);
      const response = await persistProductStructure(
        event.data.id,
        nextRows,
        field === "tags" ? newValue : nextRows[0]?.tags || "",
      );
      if (!response.ok) {
        setRows((current) => [
          ...current.filter((row) => row.id !== event.data.id),
          ...previousRows,
        ]);
        setStatus(`未能保存 ${event.data.sku} 的分类，已恢复原值。`);
        return;
      }
      setStatus(`已保存 ${event.data.sku} 的分类与标签`);
      return;
    }
    let patch: Record<string, unknown>;
    let updatedRow = event.data;
    let undoItem: UndoItem;

    if (field === "colorTag") {
      patch = { colorTag: String(event.newValue) };
      updatedRow = { ...event.data, colorTag: String(event.newValue) };
      undoItem = {
        productId: event.data.id,
        sku: event.data.sku,
        patch: { colorTag: String(event.oldValue) },
        restoreRow: { ...event.data, colorTag: String(event.oldValue) },
      };
    } else if (field === "productName") {
      patch = { name: String(event.newValue).trim() };
      updatedRow = { ...event.data, productName: String(event.newValue).trim(), name: String(event.newValue).trim() };
      undoItem = {
        productId: event.data.id,
        sku: event.data.sku,
        patch: { name: event.data.productName },
        restoreRow: event.data,
      };
    } else if (field === "specification" || field === "unit" || field === "supplyMethod") {
      const value = String(event.newValue).trim();
      const patchField = field === "specification" ? "specification" : field;
      patch = { [patchField]: value };
      updatedRow = { ...event.data, [field]: value };
      undoItem = {
        productId: event.data.id,
        sku: event.data.sku,
        patch: { [patchField]: event.data[field] },
        restoreRow: event.data,
      };
    } else if (field === "price" || field === "cost" || field === "branchPrice") {
      const text = String(event.newValue).trim();
      const value = text === "" ? null : Number(text);
      if (value !== null && !Number.isFinite(value)) return;
      patch = { [field]: value };
      updatedRow = { ...event.data, [field]: value };
      undoItem = {
        productId: event.data.id,
        sku: event.data.sku,
        patch: { [field]: event.data[field] },
        restoreRow: event.data,
      };
    } else {
      return;
    }

    setRows((current) =>
      current.map((row) =>
        row.id === event.data.id ? { ...row, ...updatedRow, rowId: row.rowId } : row,
      ),
    );
    setStatus(`正在保存 ${event.data.sku}…`);
    const response = await fetch("/api/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: event.data.id, patch }),
    });
    if (response.ok) {
      setUndoStack((current) => [
        ...current,
        { label: event.data.sku, items: [undoItem] },
      ]);
      setStatus(`已保存 ${event.data.sku}`);
    } else {
      setRows((current) =>
        current.map((row) =>
          row.id === event.data.id
            ? { ...row, ...undoItem.restoreRow, rowId: row.rowId }
            : row,
        ),
      );
      setStatus(`未能保存 ${event.data.sku}，已恢复原值。`);
    }
  };

  const undoLastChange = async () => {
    const lastChange = undoStack.at(-1);
    if (!lastChange) return;
    setStatus(`正在撤销 ${lastChange.label}…`);
    for (const item of lastChange.items) {
      const response = await fetch("/api/catalog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: item.productId, patch: item.patch }),
      });
      if (!response.ok) {
        setStatus(`未能撤销 ${lastChange.label}，请重试。`);
        return;
      }
    }
    setRows((current) =>
      current.map((row) =>
        lastChange.items.find((item) => item.productId === row.id)?.restoreRow || row,
      ),
    );
    setUndoStack((current) => current.slice(0, -1));
    setStatus(`已撤销 ${lastChange.label} 的修改`);
  };

  const applyBatchCategory = async () => {
    if (!selectedRows.length) return;
    if (!batchLevel1 && !batchCategory1 && !batchCategory2 && !batchTags)
      return;
    const selectedIds = new Set(selectedRows.map((row) => row.rowId));
    const updatedRows = rows.map((row) => {
      if (!selectedIds.has(row.rowId)) return row;
      const nextTags = batchTags ? splitTags(batchTags).join("、") : row.tags;
      const next = {
        ...row,
        level1: batchLevel1 || row.level1,
        category1: batchCategory1 || row.category1,
        category2: batchCategory2 || row.category2,
        tags: nextTags,
        productType:
          splitTags(nextTags).find((tag) => productTypeChoices.includes(tag)) || row.productType,
      };
      return {
        ...next,
        categoryPath: categoryPath(next.level1, next.category1, next.category2),
      };
    });
    const productIds = [...new Set(selectedRows.map((row) => row.id))];
    setStatus(`正在批量修改 ${selectedRows.length} 条分类记录…`);
    for (const productId of productIds) {
      const productRows = updatedRows.filter((row) => row.id === productId);
      const response = await persistProductStructure(productId, productRows, productRows[0]?.tags || "");
      if (!response.ok) {
        setStatus("部分分类记录未能保存，请重试。");
        await load();
        return;
      }
    }
    setRows(updatedRows);
    setBatchLevel1("");
    setBatchCategory1("");
    setBatchCategory2("");
    setBatchTags("");
    setStatus(`已批量修改 ${selectedRows.length} 条分类记录`);
  };

  const addClassificationRecord = () => {
    const source = selectedRows[0];
    if (!source) return;
    const rowId = crypto.randomUUID();
    setRows((current) => [
      ...current,
      {
        ...source,
        rowId,
        category2: "",
        categoryPath: categoryPath(source.level1, source.category1, ""),
      },
    ]);
    setStatus(`已为 ${source.sku} 新增空白分类记录，请填写 3级分类后保存。`);
  };

  const deleteClassificationRecords = async () => {
    if (!selectedRows.length) return;
    const selectedIds = new Set(selectedRows.map((row) => row.rowId));
    const productIds = [...new Set(selectedRows.map((row) => row.id))];
    for (const productId of productIds) {
      const existing = rows.filter((row) => row.id === productId);
      const remaining = existing.filter((row) => !selectedIds.has(row.rowId));
      if (!remaining.length) {
        setStatus(`${existing[0]?.sku || "该 SKU"} 至少需要保留一条分类记录。`);
        return;
      }
      const response = await persistProductStructure(productId, remaining, remaining[0].tags);
      if (!response.ok) {
        setStatus("删除分类记录失败，请重试。");
        return;
      }
    }
    setRows((current) => current.filter((row) => !selectedIds.has(row.rowId)));
    setSelectedRows([]);
    setStatus(`已删除 ${selectedIds.size} 条分类记录，SKU 主资料仍保留。`);
  };

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        headerName: "选择",
        width: 72,
        minWidth: 72,
        maxWidth: 72,
        checkboxSelection: true,
        headerCheckboxSelection: true,
        sortable: false,
        filter: false,
      },
      {
        headerName: "图片",
        field: "image",
        width: 86,
        minWidth: 86,
        maxWidth: 86,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<GridRow, string>) =>
          params.value ? (
            <img className="skuGridImage" src={params.value} alt="" />
          ) : (
            <span className="skuGridImageEmpty">暂无图</span>
          ),
      },
      { headerName: "名称", field: "productName", minWidth: 180, flex: 1, editable: true },
      { headerName: "款号", field: "sku", minWidth: 126 },
      {
        headerName: "1级分类",
        field: "level1",
        minWidth: 210,
        editable: true,
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: { values: batchLevel1Options },
      },
      {
        headerName: "2级分类",
        field: "category1",
        minWidth: 120,
        editable: true,
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: { values: primaryCategoryChoices },
      },
      {
        headerName: "3级分类",
        field: "category2",
        minWidth: 140,
        editable: true,
      },
      {
        headerName: "标签",
        field: "tags",
        minWidth: 180,
        editable: true,
      },
      { headerName: "尺寸", field: "specification", minWidth: 160, editable: true },
      { headerName: "单位", field: "unit", minWidth: 100, editable: true },
      {
        headerName: "成本（CNY）",
        field: "cost",
        minWidth: 130,
        editable: true,
        filter: "agNumberColumnFilter",
        valueFormatter: (params) =>
          params.value === null || params.value === undefined || params.value === ""
            ? "待补"
            : `¥${Number(params.value).toLocaleString("zh-CN")}`,
      },
      {
        headerName: "分公司价（USD）",
        field: "branchPrice",
        minWidth: 150,
        editable: true,
        filter: "agNumberColumnFilter",
        valueFormatter: (params) =>
          params.value === null || params.value === undefined || params.value === ""
            ? "待补"
            : `US$${Number(params.value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      {
        headerName: "售价（CNY）",
        field: "price",
        minWidth: 130,
        editable: true,
        filter: "agNumberColumnFilter",
        valueFormatter: (params) =>
          params.value === null || params.value === undefined
            ? "—"
            : `¥${Number(params.value).toLocaleString("zh-CN")}`,
      },
      {
        headerName: "供应方式",
        field: "supplyMethod",
        minWidth: 120,
        editable: true,
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: { values: supplyMethodChoices },
        valueFormatter: (params) => params.value || "待补",
      },
      {
        headerName: "颜色",
        field: "colorTag",
        minWidth: 130,
        editable: true,
        cellRenderer: (params: ICellRendererParams<GridRow, string>) => (
          <span className="gridColourValue">
            <ColourDot value={params.value || ""} />
            {params.value}
          </span>
        ),
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: { values: colorChoices, showColour: true },
      },
      {
        headerName: "备注",
        field: "note",
        minWidth: 220,
        flex: 1,
        tooltipField: "note",
      },
    ],
    [batchLevel1Options],
  );

  if (adminAccess !== "granted") {
    return (
      <main className="skuGridPage skuGridAccess">
        <section className="skuGridAccessCard">
          <span>ADMIN ACCESS</span>
          <h1>{adminAccess === "checking" ? "正在验证权限…" : "仅管理员可访问"}</h1>
          <p>
            {adminAccess === "checking"
              ? "正在确认当前账号权限。"
              : "员工账号只能浏览产品、制作报价单、导入清单和导出文件。"}
          </p>
          {adminAccess === "denied" && (
            <a className="outline" href="/">
              返回报价系统
            </a>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={`skuGridPage ${pairingStandalone ? "pairingStandalone" : ""}`}>
      {!pairingStandalone && (
        <>
      <header className="skuGridHeader">
        <div className="skuGridIdentity">
          <a className="workspaceBrand" href="/" aria-label="返回主页">
            <img src="/brand/yifun-life-logo.png?v=bb45e13732b7" alt="亦玩集团 Yifun Life" />
          </a>
          <div className="skuGridTitle">
            <span>PRODUCT LIST MANAGEMENT</span>
            <h1>产品清单管理</h1>
            <p>{status}</p>
          </div>
        </div>
        <div className="skuGridActions">
          <button
            className="outline"
            disabled={!undoStack.length}
            onClick={() => void undoLastChange()}
          >
            撤销上一步{undoStack.length ? ` (${undoStack.length})` : ""}
          </button>
          <button className="outline" onClick={() => window.close()}>
            关闭窗口
          </button>
        </div>
      </header>
      <section className="skuGridToolbar">
        <label>
          搜索 SKU、款号、分类、颜色或备注
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="输入关键词搜索全部 SKU"
          />
        </label>
        <small>左侧按 1、2、3 级折叠查看；表格中每一行代表一条分类记录。</small>
      </section>
      <section className="skuClassificationLayout">
        <aside className="classificationTree" aria-label="1、2、3级分类目录">
          <button
            className={!directoryFilter.level1 ? "active" : ""}
            onClick={() => setDirectoryFilter({})}
            type="button"
          >
            全部分类记录 <span>{rows.length}</span>
          </button>
          {[...directoryTree.entries()].map(([level1, level2Map]) => (
            <details open key={level1}>
              <summary>
                <span>{level1}</span>
                <small>{[...level2Map.values()].reduce((sum, values) => sum + values.size, 0)}</small>
              </summary>
              {[...level2Map.entries()].map(([level2, level3Set]) => (
                <details key={`${level1}:${level2}`}>
                  <summary>
                    <span>{level2}</span>
                    <small>{level3Set.size}</small>
                  </summary>
                  {[...level3Set].sort().map((level3) => (
                    <button
                      className={
                        directoryFilter.level1 === level1 &&
                        directoryFilter.level2 === level2 &&
                        directoryFilter.level3 === level3
                          ? "active"
                          : ""
                      }
                      key={`${level1}:${level2}:${level3}`}
                      onClick={() => setDirectoryFilter({ level1, level2, level3 })}
                      type="button"
                    >
                      {level3}
                      <span>{rows.filter((row) => row.level1 === level1 && row.category1 === level2 && row.category2 === level3).length}</span>
                    </button>
                  ))}
                </details>
              ))}
            </details>
          ))}
        </aside>
        <div className="ag-theme-quartz skuGridTable">
        <AgGridReact<GridRow>
          rowData={displayedRows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          quickFilterText={search}
          rowSelection="multiple"
          suppressRowClickSelection
          animateRows
          pagination
          paginationPageSize={100}
          paginationPageSizeSelector={[50, 100, 250]}
          onCellValueChanged={saveChange}
          onSelectionChanged={(event: SelectionChangedEvent<GridRow>) =>
            setSelectedRows(event.api.getSelectedRows())
          }
          getRowId={(params) => params.data.rowId}
          rowHeight={64}
        />
        </div>
      </section>
      {!!selectedRows.length && (
        <section className="skuBatchBar" aria-label="批量操作">
          <b>已选择 {selectedRows.length} 条记录</b>
          <label>
            1级分类
            <select value={batchLevel1} onChange={(event) => setBatchLevel1(event.target.value)}>
              <option value="">不修改1级分类</option>
              {batchLevel1Options.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
          <label>
            2级分类
            <select
              value={batchCategory1}
              onChange={(event) => setBatchCategory1(event.target.value)}
            >
              <option value="">不修改2级分类</option>
              {batchCategory1Options.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            3级分类
            <select
              value={batchCategory2}
              onChange={(event) => setBatchCategory2(event.target.value)}
            >
              <option value="">不修改3级分类</option>
              {batchCategory2Options.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            标签
            <input
              value={batchTags}
              onChange={(event) => setBatchTags(event.target.value)}
              placeholder="多个标签用逗号分隔"
            />
          </label>
          <button className="outline" onClick={addClassificationRecord} type="button">＋ 新增分类记录</button>
          <button className="outline" onClick={() => void deleteClassificationRecords()} type="button">删除分类记录</button>
          <button
            className="primary"
            disabled={
              !batchLevel1 && !batchCategory1 && !batchCategory2 && !batchTags
            }
            onClick={() => void applyBatchCategory()}
          >
            应用所选分类
          </button>
        </section>
      )}
        </>
      )}
      {pairingOpen && (
        <div className="pairingOverlay">
          <section className="pairingManager" aria-label="管理产品配对">
            <header className="pairingHead">
              <div className="pairingIdentity">
                <a className="pairingBrand" href="/" aria-label="返回主页">
                  <img src="/brand/yifun-life-logo.png?v=bb45e13732b7" alt="亦玩集团 Yifun Life" />
                </a>
                <div>
                  <span>PRODUCT PAIRING</span>
                  <h2>玩具配对管理</h2>
                </div>
              </div>
              <div className="pairingHeadActions">
                <a className="outline" href="/product-list" target="_blank" rel="noreferrer">
                  产品清单管理
                </a>
                <button onClick={closePairingManager} aria-label="返回报价系统">
                  ×
                </button>
              </div>
            </header>
            <div className="pairingFilters">
              <label>
                模拟区分类
                <select
                  value={pairingCategory}
                  onChange={(event) => {
                    setPairingCategory(event.target.value);
                    setPairingSourceId("");
                    setPairingTargetIds(new Set());
                    setPairingQuantities({});
                    setPairingSavedMessage("");
                  }}
                >
                  {simulationCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label className="pairingSearch">
                查找产品或款号
                <input
                  value={pairingSearch}
                  onChange={(event) => setPairingSearch(event.target.value)}
                  placeholder="输入名称、英文或款号"
                  type="search"
                />
              </label>
              <p>竖排为模拟区主设备，横排为同区域配套产品与玩具；交叉格填写绑定数量。</p>
            </div>
            <div className="pairingMatrixLayout">
              <aside className="pairingPinnedColumn" aria-label="模拟区主设备">
                <div className="pairingPinnedHeader">
                  模拟区主设备
                  <small>{pairingSimulationRows.length} 项</small>
                </div>
                <div
                  className="pairingPinnedRows"
                  ref={pairingPinnedRowsRef}
                  onScroll={(event) => {
                    const matrix = pairingMatrixWrapRef.current;
                    if (matrix && matrix.scrollTop !== event.currentTarget.scrollTop)
                      matrix.scrollTop = event.currentTarget.scrollTop;
                  }}
                >
                  {pairingSimulationRows.map((source) => {
                    const matchedToys = pairingToyRows.flatMap((toy) => {
                      const quantity = pairingMatrix[source.id]?.[toy.id] || 0;
                      return quantity > 0 ? [{ quantity }] : [];
                    });
                    const matchedToyQuantity = matchedToys.reduce(
                      (total, toy) => total + toy.quantity,
                      0,
                    );
                    return (
                      <article className="pairingPinnedSource" key={source.id}>
                        {source.image && <img src={source.image} alt="" />}
                        <span>
                          <b>{source.sku}</b>
                          <small>{source.productName}</small>
                          <span className="pairingSourceSummary">
                            <em>已匹配 {matchedToys.length} 款</em>
                            <strong>总数 {matchedToyQuantity} 件</strong>
                          </span>
                          <i>库存 / Stock：{source.stock === null ? "待维护" : source.stock}</i>
                        </span>
                      </article>
                    );
                  })}
                </div>
              </aside>
              <div
                className="pairingMatrixWrap"
                ref={pairingMatrixWrapRef}
                onScroll={(event) => {
                  if (pairingPinnedRowsRef.current)
                    pairingPinnedRowsRef.current.scrollTop = event.currentTarget.scrollTop;
                }}
              >
                <table className="pairingMatrix">
                  <thead>
                    <tr>
                      {pairingToyRows.map((toy) => (
                        <th key={toy.id} scope="col" title={`${toy.sku} · ${toy.productName}`}>
                          <div className="pairingToyHeader">
                            {toy.image && <img src={toy.image} alt="" />}
                            <b>{toy.sku}</b>
                            <i>{toy.productType} · 库存 / Stock：{toy.stock === null ? "待维护" : toy.stock}</i>
                            <small>{toy.productName}</small>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pairingSimulationRows.map((source) => (
                      <tr key={source.id}>
                        {pairingToyRows.map((toy) => (
                          <td key={toy.id}>
                            <input
                              aria-label={`${source.sku} 配对 ${toy.sku} 的数量`}
                              onChange={(event) =>
                                setMatrixQuantity(
                                  source.id,
                                  toy.id,
                                  Number(event.target.value.replace(/\D/g, "")) || 0,
                                )
                              }
                              inputMode="numeric"
                              pattern="[0-9]*"
                              type="text"
                              value={pairingMatrix[source.id]?.[toy.id] || 0}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <footer className="pairingFoot">
              <span>
                {pairingSavedMessage ||
                  `竖排为 ${pairingAreaSimulationRows.length} 个模拟区主设备，横排为 ${pairingToyRows.length} 个配套产品与玩具；填写数量后保存。`}
              </span>
              <div className="pairingFootActions">
                <button
                  className="outline"
                  disabled={!pairingAreaSimulationRows.length || pairingSaving}
                  onClick={clearPairingMatrix}
                >
                  清空当前表格
                </button>
                <button
                  className="primary"
                  disabled={!pairingAreaSimulationRows.length || pairingSaving}
                  onClick={() => void savePairingMatrix()}
                >
                  {pairingSaving ? "保存中…" : "保存配对表"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
