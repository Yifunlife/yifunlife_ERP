"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CellValueChangedEvent,
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { CatalogProduct } from "../catalog-types";

type Override = {
  productId: string;
  price?: string | null;
  imageUrl?: string | null;
  category1?: string | null;
  category2?: string | null;
  category3?: string | null;
  colorTag?: string | null;
};

type Category = {
  level: number;
  parentKey: string;
  name: string;
};

type GridRow = {
  id: string;
  image: string;
  sku: string;
  styleNo: string;
  category1: string;
  category2: string;
  category3: string;
  categoryPath: string;
  colorTag: string;
  price: number | null;
  note: string;
  name: string;
  en: string;
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

const categoryPath = (category1: string, category2: string, category3: string) =>
  [category1, category2, category3].filter(Boolean).join(" / ");

const gridRows = (products: CatalogProduct[], overrides: Override[]): GridRow[] => {
  const overrideById = new Map(overrides.map((override) => [override.productId, override]));
  return products.map((product) => {
    const override = overrideById.get(product.id);
    const category1 = override?.category1 || product.family;
    const category2 = override?.category2 || product.category;
    const category3 = override?.category3 || "未细分";
    return {
      id: product.id,
      image: override?.imageUrl || product.image,
      sku: product.sku,
      styleNo: product.id,
      category1,
      category2,
      category3,
      categoryPath: categoryPath(category1, category2, category3),
      colorTag:
        category1 === "小玩具"
          ? "不适用"
          : override?.colorTag || (product.image ? "待重新识别" : "无主图"),
      price:
        override?.price === undefined || override.price === null || override.price === ""
          ? product.price
          : Number(override.price),
      note: product.note || product.priceNote,
      name: product.name,
      en: product.en,
    };
  });
};

export function ProductGridManager() {
  const [rows, setRows] = useState<GridRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("正在加载产品清单…");

  const load = async () => {
    const response = await fetch("/api/catalog");
    if (!response.ok) {
      setStatus("无法加载产品清单，请返回主页面重新登录。");
      return;
    }
    const data = await response.json();
    setRows(gridRows(data.products || [], data.overrides || []));
    setCategories(data.categories || []);
    setStatus(`${(data.products || []).length} 个 SKU · 双击分类或颜色即可修改`);
  };

  useEffect(() => {
    void load();
  }, []);

  const categoryPaths = useMemo(
    () =>
      [...new Set([
        ...rows.map((row) => row.categoryPath),
        ...categories
          .filter((category) => category.level === 3)
          .map((category) => `${category.parentKey.replace("/", " / ")} / ${category.name}`),
      ])].sort(),
    [categories, rows],
  );

  const saveChange = async (event: CellValueChangedEvent<GridRow>) => {
    if (!event.data || event.newValue === event.oldValue) return;
    const field = event.colDef.field;
    let patch: Record<string, string>;
    let updatedRow = event.data;

    if (field === "categoryPath") {
      const [category1, category2, category3 = "未细分"] = String(event.newValue)
        .split(" / ");
      patch = { category1, category2, category3 };
      updatedRow = {
        ...event.data,
        category1,
        category2,
        category3,
        categoryPath: categoryPath(category1, category2, category3),
        colorTag: category1 === "小玩具" ? "不适用" : event.data.colorTag,
      };
    } else if (field === "colorTag") {
      patch = { colorTag: String(event.newValue) };
      updatedRow = { ...event.data, colorTag: String(event.newValue) };
    } else {
      return;
    }

    setRows((current) =>
      current.map((row) => (row.id === event.data.id ? updatedRow : row)),
    );
    setStatus(`正在保存 ${event.data.sku}…`);
    const response = await fetch("/api/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: event.data.id, patch }),
    });
    setStatus(
      response.ok
        ? `已保存 ${event.data.sku}`
        : `未能保存 ${event.data.sku}，请刷新后重试。`,
    );
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
      { headerName: "SKU", field: "sku", minWidth: 118 },
      { headerName: "款号", field: "styleNo", minWidth: 126 },
      {
        headerName: "分类（三级）",
        field: "categoryPath",
        minWidth: 280,
        flex: 1,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: categoryPaths },
      },
      {
        headerName: "颜色",
        field: "colorTag",
        minWidth: 130,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: colorChoices },
      },
      {
        headerName: "价格（CNY）",
        field: "price",
        minWidth: 130,
        filter: "agNumberColumnFilter",
        valueFormatter: (params) =>
          params.value === null || params.value === undefined
            ? "—"
            : `¥${Number(params.value).toLocaleString("zh-CN")}`,
      },
      {
        headerName: "备注",
        field: "note",
        minWidth: 220,
        flex: 1,
        tooltipField: "note",
      },
    ],
    [categoryPaths],
  );

  return (
    <main className="skuGridPage">
      <header className="skuGridHeader">
        <div>
          <span>PRODUCT LIST MANAGEMENT</span>
          <h1>产品清单管理</h1>
          <p>{status}</p>
        </div>
        <button className="outline" onClick={() => window.close()}>
          关闭窗口
        </button>
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
        <small>点击列表标题可排序；标题下的筛选图标可进行列筛选。</small>
      </section>
      <section className="ag-theme-quartz skuGridTable">
        <AgGridReact<GridRow>
          rowData={rows}
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
          getRowId={(params) => params.data.id}
          rowHeight={64}
        />
      </section>
    </main>
  );
}
