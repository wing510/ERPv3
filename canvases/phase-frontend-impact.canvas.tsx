// @ts-nocheck
import { Callout, Divider, Grid, H1, H2, Pill, Row, Spacer, Stack, Stat, Table, Text } from "cursor/canvas";

type Impact = "不變" | "小" | "中" | "大";

export default function PhaseFrontendImpact() {
  const rows: Array<[string, string, Impact, string, string, string]> = [
    [
      "Phase 0",
      "全系統",
      "不變",
      "不改操作；只新增文件",
      "把規則寫清楚（交易表/半交易/主檔）",
      "你只需審閱文件是否符合現況",
    ],

    [
      "Phase 1",
      "Receive（收貨）",
      "不變",
      "維持「產生批次/作廢」走 bundle",
      "封鎖通用側門，避免有人直接寫 goods_receipt/import_receipt",
      "回歸：產生批次→作廢→確認 PO/報單狀態與 Lot/Movement 同步",
    ],
    [
      "Phase 1",
      "Shipping（出貨）",
      "不變",
      "維持「過帳/作廢」走 bundle；備註走 remark command",
      "封鎖通用側門，避免直接改 shipment/ship_item 破壞追溯",
      "回歸：過帳→作廢→備註→Logs；重送 idempotency_key 不得重複過帳",
    ],
    [
      "Phase 1",
      "Import（進口報單）",
      "小",
      "舊版「進口收貨 + 建Lot」流程會被明確停用（已導向 Receive）",
      "避免分段寫入繞過 bundle，造成 lot/movement 不一致",
      "只要照現行提示改用 Receive，就不影響日常作業",
    ],

    [
      "Phase 2",
      "Purchase（採購）",
      "中",
      "按鈕流程保留（編輯主檔/明細/儲存備註），但「後端硬擋」會更嚴",
      "避免已收貨後仍被通用 update 改結構欄位",
      "回歸：OPEN 可改；一旦有收貨（GR 未作廢）就禁止改數量/品項等結構欄位",
    ],
    [
      "Phase 2",
      "Sales（銷售）",
      "中",
      "按鈕流程保留，但「已出貨/已關聯下游」後端會硬擋不合法修改",
      "避免已產生 shipment 後仍能改 so_item_qty 等造成對不上",
      "回歸：有下游就鎖結構；備註仍可走 remark-only（受狀態限制）",
    ],
    [
      "Phase 2",
      "Import（進口報單）",
      "中",
      "按鈕流程保留，但「已收貨」後端硬擋結構修改；明細重建只允許未收貨",
      "避免 import_item 與 import_receipt 匯總不一致",
      "回歸：OPEN 且無收貨可改；一旦有收貨就禁止改申報量/品項",
    ],

    [
      "Phase 3",
      "全交易表相關模組",
      "小",
      "文案/提示/按鈕啟用條件更一致（你之前要求的對齊類）",
      "降低使用者學習成本、避免誤操作",
      "你主要確認：文案是否符合現場用語、是否有誤導",
    ],

    [
      "Phase 1→3（視需要）",
      "Merge / Split / Transfer / Outsource（特殊庫存作業）",
      "中",
      "合批/拆批/轉倉已改走 bundle；其餘特殊流程若仍分段寫入，才需要收斂",
      "把高風險庫存操作收進「一次完成」的後端流程，避免寫到一半失敗或被繞過",
      "回歸：合批/拆批/轉倉各跑 1 次（含重送 idempotency）；Outsource 以既有 bundle（撤回送加工/作廢回收）為準",
    ],

    [
      "Phase 4",
      "全系統",
      "不變",
      "不改流程；只做回歸/分批上線",
      "控制風險、可回退",
      "你配合：用 DEV 先跑回歸清單，再上 PROD",
    ],
  ];

  return (
    <Stack gap={18}>
      <Row align="center">
        <H1>Phase 對前端操作流程的影響清單（可指著對齊）</H1>
        <Spacer />
        <Pill tone="neutral" size="small">
          v1
        </Pill>
      </Row>

      <Callout tone="info">
        <Text>
          讀法：看「影響程度」＋「會改哪個操作」。原則是 Phase 1 幾乎不改日常流程，只封側門；Phase 2
          才是規則變嚴（但按鈕流程盡量保留）；Phase 3 做一致化文案/提示。
        </Text>
      </Callout>

      <Grid columns={4} gap={12}>
        <Stat value="不變/小" label="Phase 0 / 1 / 4" tone="success" />
        <Stat value="中" label="Phase 2（規則硬擋）" tone="warning" />
        <Stat value="小" label="Phase 3（一致化）" tone="success" />
        <Stat value="大" label="特殊庫存作業可能需改造" tone="warning" />
      </Grid>

      <Divider />

      <H2>影響清單</H2>
      <Table
        headers={["Phase", "模組/範圍", "影響", "會改哪個操作", "目的/原因", "你需要做什麼（驗收/回歸）"]}
        rows={rows}
        columnAlign={["left", "left", "left", "left", "left", "left"]}
      />
    </Stack>
  );
}

