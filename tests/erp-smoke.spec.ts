import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type SmokeConfig = {
  siteUrl: string;
  expectedVersion?: string;
  login: { userId: string; password: string };
  fullFlow?: boolean;
  fixtures?: {
    warehouseId: string;
    poId: string;
    soId: string;
    soItemId: string;
    receiveQty?: number;
    shipQty?: number;
    voidReasonIndex?: number; // 1 = 第一個非空原因
  };
};

function readConfig(): SmokeConfig {
  const p =
    process.env.ERP_SMOKE_CONFIG ||
    path.join(process.cwd(), "docs", "erp-smoke-config.json");
  if (!fs.existsSync(p)) {
    throw new Error(
      `找不到設定檔：${p}\n請複製 docs/erp-smoke-config.example.json → docs/erp-smoke-config.json 並填入登入資訊`
    );
  }
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as SmokeConfig;
}

async function waitForAppReady(page: Page) {
  // 等到左側選單或內容區出現（避免尚在登入遮罩）
  await page.waitForSelector("#sidebarNav", { state: "attached" });
  await page.waitForSelector("#content", { state: "attached" });
}

async function navigateModule(page: Page, moduleKey: string) {
  await page.evaluate((k: string) => {
    // @ts-ignore
    if (typeof window.navigate === "function") window.navigate(k);
    else location.hash = "#" + k;
  }, moduleKey);
}

async function selectOptionValue(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { state: "attached" });
  await page.selectOption(selector, { value });
}

async function waitForOptionsLoaded(page: Page, selector: string, minOptions = 2) {
  await page.waitForFunction(
    ([sel, n]) => {
      const el = document.querySelector(sel) as HTMLSelectElement | null;
      return !!el && el.options && el.options.length >= Number(n);
    },
    [selector, String(minOptions)]
  );
}

async function waitForNonEmptyOptions(page: Page, selector: string, minCount = 1) {
  await page.waitForFunction(
    ([sel, n]) => {
      const el = document.querySelector(sel) as HTMLSelectElement | null;
      if (!el || !el.options) return false;
      const valid = Array.from(el.options).filter((o) => String(o.value || "").trim() !== "");
      return valid.length >= Number(n);
    },
    [selector, String(minCount)]
  );
}

async function acceptNextDialog(page: Page) {
  page.once("dialog", async (d) => {
    try {
      await d.accept();
    } catch (_e) {}
  });
}

async function loginIfNeeded(page: Page, cfg: SmokeConfig) {
  async function attemptLoginOnce() {
    await page.waitForSelector("#loginOverlay", { state: "attached" });
    const userInput = page.locator("#loginUserId");
    const passInput = page.locator("#loginPassword");
    const submitBtn = page.locator("#loginSubmitBtn");
    let canSeeLogin = (await userInput.isVisible().catch(() => false)) && (await passInput.isVisible().catch(() => false));

    // 本機測試模式：先嘗試打開帳密區（管理者勾選 / 本機測試登入）
    if (!canSeeLogin) {
      const localBtn = page.locator("#loginLocalTestBtn");
      if (await localBtn.isVisible().catch(() => false)) {
        await localBtn.click().catch(() => {});
      } else {
        await page.evaluate(() => {
          const cfg = (window as any).__ERP_CONFIG__ || ((window as any).__ERP_CONFIG__ = {});
          cfg.ALLOW_PASSWORD_LOGIN = true;
          const btn = document.getElementById("loginLocalTestBtn") as HTMLButtonElement | null;
          if (btn) btn.style.display = "";
          const wrap = document.getElementById("loginAdminToggleWrap");
          if (wrap) (wrap as HTMLElement).style.display = "";
        });
      }
      const adminToggle = page.locator("#loginAdminToggle");
      if (await adminToggle.isVisible().catch(() => false)) {
        await adminToggle.check().catch(() => {});
      }
      canSeeLogin = (await userInput.isVisible().catch(() => false)) && (await passInput.isVisible().catch(() => false));
    }

    if (canSeeLogin) {
      await userInput.fill(cfg.login.userId);
      await passInput.fill(cfg.login.password);
      await submitBtn.click();
    }
    await waitForAppReady(page);
  }

  await attemptLoginOnce();
  const locked = await page.locator("body").evaluate((el) => el.classList.contains("erp-locked"));
  if (locked) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await attemptLoginOnce();
  }
  await expect(page.locator("body")).not.toHaveClass(/erp-locked/);
}

async function runReceiveVoidLoop(page: Page, fx: Required<SmokeConfig>["fixtures"]) {
  const receiveQty = Number(fx.receiveQty ?? 1);
  const voidReasonIndex = Number(fx.voidReasonIndex ?? 1);

  await navigateModule(page, "receive");
  await page.waitForSelector("#rcv_source_type", { state: "attached" });

  await selectOptionValue(page, "#rcv_source_type", "PO");
  await waitForOptionsLoaded(page, "#rcv_source_id", 2);
  await selectOptionValue(page, "#rcv_source_id", fx.poId);

  await waitForOptionsLoaded(page, "#rcv_warehouse", 2);
  await selectOptionValue(page, "#rcv_warehouse", fx.warehouseId.toUpperCase());

  // 等明細 render 出 qty input，填第一筆
  await page.waitForSelector("#rcv_qty_0", { state: "attached" });
  await page.fill("#rcv_qty_0", String(receiveQty));

  // 記下收貨單號（作廢要用）
  const receiptId = (await page.inputValue("#rcv_receipt_id")).trim();
  expect(receiptId).toBeTruthy();

  await page.click("#rcv_post_btn");
  // 過帳後會跳 lots；等一下避免 race
  await page.waitForTimeout(800);

  // 回到收貨頁，用同一張 PO 開啟已收列表並作廢剛才那張
  await navigateModule(page, "receive");
  await page.waitForSelector("#rcv_source_type", { state: "attached" });
  await selectOptionValue(page, "#rcv_source_type", "PO");
  await waitForOptionsLoaded(page, "#rcv_source_id", 2);
  await selectOptionValue(page, "#rcv_source_id", fx.poId);
  await page.waitForTimeout(500);

  await page.click("#rcvPostedPanel > summary");
  await page.waitForSelector("#rcvPostedBody", { state: "attached" });
  await page.waitForSelector(`button[data-rcv-receipt-id="${receiptId}"]`, { state: "attached" });
  await page.click(`button[data-rcv-receipt-id="${receiptId}"]`);

  // 作廢 modal：選原因 + 確認
  await page.waitForSelector("#rcvVoidModal.rcv-void-modal-open", { state: "visible" });
  await page.waitForSelector("#rcv_void_reason_code", { state: "attached" });
  await page.selectOption("#rcv_void_reason_code", { index: voidReasonIndex });

  await page.click("#rcv_void_modal_confirm");
  await page.waitForTimeout(800);

  // 驗證：已收列表中該單據顯示已作廢（或作廢按鈕變成無法作廢）
  await page.click("#rcvPostedPanel > summary");
  await page.waitForTimeout(500);
  await expect(page.locator("#rcvPostedBody")).toContainText(receiptId);
  await expect(page.locator("#rcvPostedBody")).toContainText("已作廢");
}

async function runShipmentCancelLoop(page: Page, fx: Required<SmokeConfig>["fixtures"]) {
  const shipQty = Number(fx.shipQty ?? 1);

  await navigateModule(page, "shipping");
  await page.waitForSelector("#ship_so_id", { state: "attached" });
  await selectOptionValue(page, "#ship_so_id", fx.soId);

  // 等銷售品項載入完成，再選指定品項
  await waitForOptionsLoaded(page, "#ship_so_item_id", 2);
  await selectOptionValue(page, "#ship_so_item_id", fx.soItemId);

  // 啟用自動配批（預設已勾），填數量並新增明細
  await page.check("#ship_auto_alloc").catch(() => {});
  await page.fill("#ship_qty", String(shipQty));
  await page.getByRole("button", { name: "新增明細" }).click();

  const shipmentId = (await page.inputValue("#ship_id")).trim().toUpperCase();
  expect(shipmentId).toBeTruthy();

  await page.click("#ship_post_btn");
  await page.waitForTimeout(1200);

  // 作廢會跳 confirm dialog
  await acceptNextDialog(page);
  await page.click("#ship_cancel_btn");
  await page.waitForTimeout(1200);

  // 驗證狀態提示變為已作廢
  await expect(page.locator("#shipInvState")).toContainText("已作廢");
  await expect(page.locator("#shipInvState")).toContainText("已反沖");
}

async function seedFixturesIfNeeded(page: Page, cfg: SmokeConfig): Promise<{ tag: string; fx: Required<SmokeConfig>["fixtures"] }> {
  if (cfg.fixtures && cfg.fixtures.poId && cfg.fixtures.soId && cfg.fixtures.soItemId && cfg.fixtures.warehouseId) {
    return { tag: "MANUAL", fx: cfg.fixtures as Required<SmokeConfig>["fixtures"] };
  }

  // 從前端取出 API_BASE 與 session token，直接呼叫後端 dev_seed_smoke_fixtures
  const apiBase = await page.evaluate(() => {
    // @ts-ignore
    const c = (window.__ERP_CONFIG__ || {}) as any;
    return String(c.API_BASE || "").trim();
  });
  const token = await page.evaluate(() => {
    try { return String(localStorage.getItem("erp_session_token") || sessionStorage.getItem("erp_session_token") || "").trim(); }
    catch (_e) { return ""; }
  });
  const actorId = String(cfg.login?.userId || "").trim();
  if (!apiBase) throw new Error("取不到 API_BASE（window.__ERP_CONFIG__.API_BASE）");
  if (!token) throw new Error("取不到 session token（請確認已登入成功）");
  if (!actorId) throw new Error("設定檔缺少 login.userId");

  const tag = "SMOKE-" + Date.now();
  const res = await page.request.post(apiBase, {
    form: {
      action: "dev_seed_smoke_fixtures",
      tag,
      created_by: actorId,
      session_token: token
    }
  });
  const j: any = await res.json();
  if (!j || j.success !== true) {
    throw new Error("seed fixtures 失敗：" + JSON.stringify(j));
  }

  const fx = j.fixtures || j.data?.fixtures || j.data || j;
  return {
    tag: String(j.tag || tag),
    fx: {
      warehouseId: String(fx.warehouseId || fx.warehouse_id || ""),
      poId: String(fx.poId || fx.po_id || ""),
      soId: String(fx.soId || fx.so_id || ""),
      soItemId: String(fx.soItemId || fx.so_item_id || ""),
      receiveQty: Number(cfg.fixtures?.receiveQty ?? 1),
      shipQty: Number(cfg.fixtures?.shipQty ?? 1),
      voidReasonIndex: Number(cfg.fixtures?.voidReasonIndex ?? 1)
    }
  };
}

async function cleanupFixtures(page: Page, cfg: SmokeConfig, tag: string) {
  if (!tag || tag === "MANUAL") return;
  const apiBase = await page.evaluate(() => {
    // @ts-ignore
    const c = (window.__ERP_CONFIG__ || {}) as any;
    return String(c.API_BASE || "").trim();
  });
  const token = await page.evaluate(() => {
    try { return String(localStorage.getItem("erp_session_token") || sessionStorage.getItem("erp_session_token") || "").trim(); }
    catch (_e) { return ""; }
  });
  const actorId = String(cfg.login?.userId || "").trim();
  if (!apiBase || !token || !actorId) return;

  await page.request.post(apiBase, {
    form: {
      action: "dev_cleanup_smoke_fixtures",
      tag,
      updated_by: actorId,
      session_token: token
    }
  }).catch(() => {});
}

test("ERP v3.3 上線冒煙：登入 + 核心頁面可開啟", async ({ page }) => {
  const cfg = readConfig();
  const siteUrl = String(cfg.siteUrl || "").replace(/\/+$/, "");
  const expectedVersion = String(cfg.expectedVersion || "3.3").trim();

  await page.goto(`${siteUrl}/index.html`, { waitUntil: "domcontentloaded" });

  // 版本字樣（title + sidebar + topbar）
  await expect(page).toHaveTitle(new RegExp(`ERP\\s+v${expectedVersion}`));
  await expect(page.locator("nav.sidebar h2")).toContainText(`ERP v${expectedVersion}`);
  await expect(page.locator(".topbar-version-label")).toContainText(`Version ${expectedVersion}`);

  // 登入（若已是登入態則直接略過）
  await loginIfNeeded(page, cfg);

  // 核心模組：能打開 & 有標題（不驗證資料內容）
  const modules: Array<{ key: string; expectText: string; expectAltText?: string }> = [
    { key: "dashboard", expectText: "Dashboard" },
    { key: "products", expectText: "Products" },
    { key: "warehouses", expectText: "Warehouses" },
    { key: "receive", expectText: "Goods Receipt" },
    { key: "lots", expectText: "Lots" },
    { key: "shipping", expectText: "Shipment" },
    { key: "trace", expectText: "Lot Traceability", expectAltText: "區塊 1：查貨（Lot）— 批次追溯" }
  ];

  for (const m of modules) {
    await navigateModule(page, m.key);
    await page.waitForTimeout(300);
    if (!m.expectAltText) {
      await expect(page.locator("#content")).toContainText(m.expectText);
    } else {
      const txt = await page.locator("#content").innerText();
      const ok = txt.includes(m.expectText) || txt.includes(m.expectAltText);
      expect(ok).toBeTruthy();
    }
  }

  if (cfg.fullFlow) {
    const seeded = await seedFixturesIfNeeded(page, cfg);
    try{
      await runReceiveVoidLoop(page, seeded.fx);
      await runShipmentCancelLoop(page, seeded.fx);
    } finally {
      await cleanupFixtures(page, cfg, seeded.tag);
    }
  }
});

test("ERP 第8項併發防誤按：收貨/出貨載入中鎖定關鍵按鈕", async ({ page }) => {
  const cfg = readConfig();
  const siteUrl = String(cfg.siteUrl || "").replace(/\/+$/, "");

  await page.goto(`${siteUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await loginIfNeeded(page, cfg);

  // 收貨：來源載入中，產生批次按鈕應鎖住
  await navigateModule(page, "receive");
  await page.waitForSelector("#rcv_source_type", { state: "attached" });
  await page.selectOption("#rcv_source_type", { value: "PO" });
  const preferredPo = String(cfg.fixtures?.poId || "").trim().toUpperCase();
  if (preferredPo) {
    try {
      await page.selectOption("#rcv_source_id", preferredPo);
      await expect(page.locator("#rcv_post_btn")).toBeDisabled();
    } catch (_e) {}
  }
  try {
    await waitForNonEmptyOptions(page, "#rcv_source_id", 1);
  } catch (_e) {
    test.skip(true, "沒有可用收貨來源可測");
  }
  const nonEmptyCount = await page.evaluate(() => {
    const el = document.querySelector("#rcv_source_id") as HTMLSelectElement | null;
    if (!el || !el.options) return 0;
    return Array.from(el.options).filter((o) => String(o.value || "").trim() !== "").length;
  });
  test.skip(nonEmptyCount < 1, "沒有可用收貨來源可測");

  await page.evaluate(() => {
    const w = window as any;
    if (typeof w.callAPI !== "function") return;
    if (w.__pw_wrap_rcv_load__) return;
    const orig = w.callAPI.bind(w);
    w.__pw_wrap_rcv_load__ = true;
    w.callAPI = async function (params: any, options: any) {
      const action = String(params?.action || "");
      if (action === "list_purchase_order_item") {
        await new Promise((r) => setTimeout(r, 800));
      }
      return orig(params, options);
    };
  });

  const firstNonEmptyVal = await page.evaluate((poId: string) => {
    const el = document.querySelector("#rcv_source_id") as HTMLSelectElement | null;
    if (!el || !el.options) return "";
    if (poId && Array.from(el.options).some((o) => String(o.value || "").trim().toUpperCase() === poId)) {
      return poId;
    }
    const opt = Array.from(el.options).find((o) => String(o.value || "").trim() !== "");
    return opt ? String(opt.value || "") : "";
  }, preferredPo);
  if (firstNonEmptyVal) {
    await page.selectOption("#rcv_source_id", firstNonEmptyVal);
    await expect(page.locator("#rcv_post_btn")).toBeDisabled();
  }

  // 出貨：Load 載入中，作廢按鈕應鎖住，避免誤按
  await navigateModule(page, "shipping");
  await page.waitForSelector("#shipTableBody", { state: "attached" });
  const loadBtn = page.locator('#shipTableBody button[onclick*="loadShipment"]').first();
  const loadCount = await page.locator('#shipTableBody button[onclick*="loadShipment"]').count();
  test.skip(loadCount === 0, "沒有可用出貨單可測 Load 鎖定");

  await page.evaluate(() => {
    const w = window as any;
    if (typeof w.callAPI !== "function") return;
    if (w.__pw_wrap_ship_load__) return;
    const orig = w.callAPI.bind(w);
    w.__pw_wrap_ship_load__ = true;
    w.callAPI = async function (params: any, options: any) {
      const action = String(params?.action || "");
      if (action === "list_shipment_item_by_shipment") {
        await new Promise((r) => setTimeout(r, 900));
      }
      return orig(params, options);
    };
  });

  await loadBtn.click();
  await expect(page.locator("#ship_cancel_btn")).toBeDisabled();
  await expect(page.locator("#shipStatusHint")).toContainText("載入中");
});

