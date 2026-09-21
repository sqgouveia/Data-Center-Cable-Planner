# SYSTEM-MAP — mapa do projeto

Gerado por `node scripts/system-map.mjs`. **Rode o script depois de mexer no código** para o
mapa continuar valendo (ele lê as linhas de verdade, não é escrito à mão).

Última geração: 2026-09-21 15:32 · app.js com 4465 linhas · 16 módulos em js/ · app.css 11106 · macos.css 3588

## 1. O que é o quê

| arquivo | papel |
|---|---|
| index.html | casca: barra de topo, duas laterais flutuantes, canvas, barra inferior e todos os modais |
| app.js | orquestra tudo: estado, render, interação do canvas e das laterais (`4465` linhas) |
| js/state.js | objeto `state` compartilhado (fonte da verdade em memória) |
| js/geometry.js | posições físicas de fileira/rack/calha + rótulo do rack (`rackDisplayName`, `findRackByLabel`) |
| js/routing.js | grafo de rota e cálculo de metragem de cabo |
| js/occupancy.js | ocupação de U por face, conflito e posição de asset |
| js/cables.js | lista de cabos, import/export XLSX e painel do cabo |
| js/catalogs.js | cadastros (tipos, fabricantes, modelos, salas) |
| js/bulk-assets.js + js/inventory-import.js | edição em massa e importação de planilha de assets |
| js/cloud-sync.js | salvar/carregar projeto na nuvem + status "Salvo" |
| js/rack-metrics.js | métricas do mapa de calor/resumo, sem DOM |
| app.css | camada base de estilo (tema claro e escuro por variáveis) |
| macos.css | camada de acabamento, **carregada depois do app.css** — quando as duas definem a mesma coisa, vale esta |

## 2. Módulos de js/ (exports e dependências)

```mermaid
graph LR
  index[index.html] --> app[app.js]
  index --> css1[app.css] --> css2[macos.css]
  app --> utils_js["utils.js"]
  app --> state_js["state.js"]
  app --> dialogs_js["dialogs.js"]
  app --> styled_select_js["styled-select.js"]
  app --> geometry_js["geometry.js"]
  app --> routing_js["routing.js"]
  app --> occupancy_js["occupancy.js"]
  app --> pdf_report_js["pdf-report.js"]
  app --> runtime_js["runtime.js"]
  app --> inventory_import_js["inventory-import.js"]
  app --> cloud_sync_js["cloud-sync.js"]
  app --> bulk_assets_js["bulk-assets.js"]
  app --> cables_js["cables.js"]
  app --> plant_export_js["plant-export.js"]
  app --> rack_metrics_js["rack-metrics.js"]
  app --> catalogs_js["catalogs.js"]
  bulk_assets_js --> utils_js["utils.js"]
  bulk_assets_js --> state_js["state.js"]
  bulk_assets_js --> occupancy_js["occupancy.js"]
  bulk_assets_js --> inventory_import_js["inventory-import.js"]
  bulk_assets_js --> cloud_sync_js["cloud-sync.js"]
  bulk_assets_js --> geometry_js["geometry.js"]
  cables_js --> utils_js["utils.js"]
  cables_js --> state_js["state.js"]
  cables_js --> dialogs_js["dialogs.js"]
  cables_js --> geometry_js["geometry.js"]
  cables_js --> routing_js["routing.js"]
  cables_js --> occupancy_js["occupancy.js"]
  catalogs_js --> utils_js["utils.js"]
  catalogs_js --> state_js["state.js"]
  catalogs_js --> dialogs_js["dialogs.js"]
  catalogs_js --> inventory_import_js["inventory-import.js"]
  catalogs_js --> cables_js["cables.js"]
  cloud_sync_js --> utils_js["utils.js"]
  cloud_sync_js --> state_js["state.js"]
  cloud_sync_js --> dialogs_js["dialogs.js"]
  cloud_sync_js --> styled_select_js["styled-select.js"]
  cloud_sync_js --> runtime_js["runtime.js"]
  dialogs_js --> utils_js["utils.js"]
  geometry_js --> state_js["state.js"]
  geometry_js --> utils_js["utils.js"]
  inventory_import_js --> utils_js["utils.js"]
  inventory_import_js --> state_js["state.js"]
  inventory_import_js --> occupancy_js["occupancy.js"]
  inventory_import_js --> geometry_js["geometry.js"]
  occupancy_js --> utils_js["utils.js"]
  pdf_report_js --> utils_js["utils.js"]
  pdf_report_js --> state_js["state.js"]
  pdf_report_js --> occupancy_js["occupancy.js"]
  pdf_report_js --> geometry_js["geometry.js"]
  pdf_report_js --> plant_export_js["plant-export.js"]
  plant_export_js --> utils_js["utils.js"]
  rack_metrics_js --> utils_js["utils.js"]
  rack_metrics_js --> occupancy_js["occupancy.js"]
  routing_js --> state_js["state.js"]
  routing_js --> utils_js["utils.js"]
  routing_js --> geometry_js["geometry.js"]
  styled_select_js --> utils_js["utils.js"]
```

| módulo | linhas | exporta (nome:linha) | importa de |
|---|---|---|---|
| `js/bulk-assets.js` | 189 | configureBulkAssets:13, addBulkRow:162, openBulkAssetsModal:168, closeBulkAssetsModal:169, saveBulkAssets:170, openAssetsImportModal:178, bindImportUI:182 | utils.js, state.js, occupancy.js, inventory-import.js, cloud-sync.js, geometry.js |
| `js/cables.js` | 510 | cables:10, configureCables:16, addCable:21, downloadCableTemplate:114, importCablesXLSX:156, closeCableTypeReviewModal:211, processCableImportRows:215, cableSummaryRows:288, … | utils.js, state.js, dialogs.js, geometry.js, routing.js, occupancy.js |
| `js/catalogs.js` | 455 | catalogs:9, configureCatalogs:16, DEFAULT_ASSET_TYPES:22, DEFAULT_ASSET_STATUSES:23, DEFAULT_ASSET_SUBSTATUSES:24, normalizeAssetCatalogs:25, bayfaceTypeColor:63, renderCableTypesCatalog:65, … | utils.js, state.js, dialogs.js, inventory-import.js, cables.js |
| `js/cloud-sync.js` | 1097 | cloud:9, configureCloudSync:17, setCloudStatus:70, updatePlannerProjectName:89, assetLogDiff:132, recordAssetAudit:175, openAssetHistory:486, closeAssetHistory:523, … | utils.js, state.js, dialogs.js, styled-select.js, runtime.js |
| `js/dialogs.js` | 80 | uiConfirm:19, uiPrompt:44 | utils.js |
| `js/geometry.js` | 391 | VIEW_PAD:8, rowForRack:11, rackDisplayName:15, findRackByLabel:24, rowIndex:44, racksInRow:45, rackAt:46, makeRack:52, … | state.js, utils.js |
| `js/inventory-import.js` | 790 | importSession:9, configureInventoryImport:19, assetStatusValues:46, makeAssetsTemplate:47, validateAssetImportRows:214, renderEditableAssetImportPreview:357, updateImportPreviewSummary:421, closeImportPreview:450, … | utils.js, state.js, occupancy.js, geometry.js |
| `js/occupancy.js` | 102 | isAssetArchived:11, assetOccupancy:15, assetsOnFace:26, assetAtRackU:31, assetsAtRackU:35, assetOwningPort:40, assetConflicts:45, occupiedUnits:57, … | utils.js |
| `js/pdf-report.js` | 376 | configurePdfReport:11, generatePDFReport:143, openPdfReportOptions:326, closePdfReportOptions:375 | utils.js, state.js, occupancy.js, geometry.js, plant-export.js |
| `js/plant-export.js` | 187 | capturePlant:45, composePlantSvg:98, bareSvg:129, svgToPngBlob:135, blobToDataUrl:152, downloadBlob:161, niceScale:171, safeFileName:175, … | utils.js |
| `js/rack-metrics.js` | 106 | HEAT_MODES:9, levelForRatio:13, rackMetrics:27, computeRackMetrics:60, heatLevel:73, summarizeRackMetrics:85 | utils.js, occupancy.js |
| `js/routing.js` | 399 | rackCableRiseMeters:15, ensureInfrastructureJunctions:23, buildRouteGraph:34, shortestPathNodes:247, calcAutomaticTrayLength:264, routePointsForAutomatic:275, dedupeRoutePoints:290, routeBetweenRacks:293, … | state.js, utils.js, geometry.js |
| `js/runtime.js` | 6 | GLOBAL_STORAGE:4, runtime:5 | — |
| `js/state.js` | 30 | THEME_STORAGE:3, state:16 | — |
| `js/styled-select.js` | 45 | closeStyledSelectPanels:6, syncSelectButton:7, openStyledSelectPanel:14, bindStyledSelect:39 | utils.js |
| `js/utils.js` | 139 | $:2, beginTask:9, endTask:19, uid:26, UI_ICONS:30, uiIcon:46, cloneData:50, esc:57, … | — |

## 3. app.js — funções por área

### Render / pintura

`updateRoomUI` (68) · `updateStructureControls` (128) · `updateHistoryButtons` (243) · `updateRenamePreview` (1009) · `updateHeatControl` (1071) · `renderRoomSummary` (1269) · `render` (1306) · `updateAlertsCenterBadge` (1718) · `updateAssetUFieldsState` (1874) · `refreshAssetRackOptions` (1902) · `renderAssetPortsEditor` (1941) · `updateAssetLifecycleBadge` (2057) · `updateAssetNotesCount` (2070) · `renderAssetsTableHead` (2296) · `renderAssetsKpis` (2350) · `renderAssetsFilterBar` (2367) · `renderAssetsPagination` (2376) · `renderAssetsTableSort` (2418) · `updateAssetsBulkBar` (2425) · `renderAssetsList` (2506) · `renderBayfaceAssetPicker` (2593) · `fitBayfaceHeight` (2749) · `renderBayface` (2820) · `renderProperties` (2936) · `renderPropertiesBody` (2947) · `refreshCableValidation` (3151) · `updateCableAssetNameField` (3163) · `renderCableProperties` (3189) · `updateCableResult` (3342) · `renderManualRouteUI` (3366) · `refreshVisuals` (3376) · `updateCanvasEmptyHint` (3415) · `renderAll` (3420) · `updateProjectSummary` (3828) · `renderQuickSearchResults` (3887) · `renderTopSearchResults` (3901) · `centerOnPoint` (3936) · `updateMinimap` (4017)

### Ligações de UI (setup/bind)

`bindRowPanelActions` (626) · `bindRowReorder` (740) · `bindSectionCollapse` (871) · `setupFocusMode` (942) · `setupSummaryRefit` (1098) · `setupEnvAdvanced` (1106) · `setupPlantExport` (1129) · `setupHeatControl` (1137) · `setupRackTooltip` (1176) · `bindAssetColumnResize` (2243) · `bindPropPanel` (2883) · `setupPropCards` (2932) · `bindCablePanelSections` (3317) · `bindManualRouteControls` (3360) · `setupPropSectionResize` (3489) · `setupPan` (3628) · `bindTopSearch` (3916) · `setupMinimap` (4078) · `setupSidebarToggle` (4131) · `setupStructureLockControl` (4153) · `bind` (4165)

### Criação e edição de dados

`applyRoomData` (40) · `applyTheme` (170) · `addRow` (572) · `removeRackReferences` (581) · `resizeRow` (588) · `deleteRow` (608) · `addRowFromPanel` (662) · `applyRenameRow` (1021) · `createIndependentTray` (1051) · `deleteAsset` (2161) · `applyAssetColumnWidths` (2239) · `assignBayfaceAsset` (2648) · `deleteSelectedTrays` (3462) · `deleteSelectedRacks` (3476)

### Busca

`rowMatchesSearch` (636) · `searchableItems` (3837) · `searchListHtml` (3882) · `renderQuickSearchResults` (3887) · `closeTopSearch` (3896) · `renderTopSearchResults` (3901) · `clearTopSearch` (3915) · `bindTopSearch` (3916) · `activateSearchResult` (3944) · `openQuickSearch` (3987) · `closeQuickSearch` (3988)

### Cálculos (geometria/rota)

`rowAddButtonHtml` (619) · `rowMatchesSearch` (636) · `computeStats` (1063) · `rackTooltipHtml` (1158)

### Cascas e modais

`addRowFromPanel` (662) · `buildRowsPanel` (670) · `openRenameRowModal` (955) · `closeRenameRowModal` (972) · `openRenameRowsModal` (974) · `closeAlertsCenterPanel` (1777) · `openAlertsCenterPanel` (1778) · `openAssetModal` (2016) · `closeAssetModal` (2056) · `openAssetsModal` (2562) · `closeAssetsModal` (2563) · `bindPropPanel` (2883) · `openHelpModal` (3981) · `closeHelpModal` (3982)

### Outras

`roomDataFromState` (39) · `syncActiveRoom` (41) · `migrateGlobalAssets` (42) · `ensureRooms` (52) · `switchRoom` (56) · `fitTopbarSelect` (57) · `switchLocation` (81) · `normalizeCableCatalogs` (94) · `cableTypeNames` (106) · `defaultCableType` (107) · `cableTypeColor` (108) · `isStructureLocked` (112) · `setStructureLock` (113) · `structureBlocked` (137) · `projectSnapshot` (141) · `historyContextKey` (188) · `initHistory` (191) · `persistHistoryContext` (210) · `recordHistory` (214) · `restoreSnapshot` (248) · `undo` (312) · `redo` (326) · `toast` (341) · `flashElement` (346) · `focusPanelItem` (356) · `flashSelection` (361) · `save` (370) · `load` (371) · `normalizeIndices` (399) · `normalizeState` (408) · `structureRebuildImpact` (477) · `structureRebuildMessage` (498) · `rebuildStructureFromSettings` (512) · `sectionHeadHeight` (786) · `animateSectionCollapse` (802) · `setRenameModalHint` (988) · `buildRenameNames` (989) · `renameTargets` (1001) · `renameConflict` (1005) · `migrateLegacyTrays` (1034) · `assetLifecycleLevel` (1062) · `positionHeatPill` (1082) · `exportPlant` (1114) · `pctText` (1156) · `kgText` (1157) · `summaryMeter` (1220) · `roomSummaryData` (1226) · `roomSummaryHtml` (1246) · `assetRoom` (1682) · `findRackGlobal` (1686) · `assetRack` (1692) · `assetRackLabel` (1695) · `assetRackRoom` (1699) · `assetWarrantyLevel` (1705) · `assetEndOfLifeLevel` (1706) · `assetsNeedingAttention` (1711) · `allProjectRacks` (1739) · `capacityIssues` (1745) · `positionIssues` (1768) · `openAssetsModalWithAttentionFilter` (1833)

## 4. Onde mexer quando…

| quero mudar… | mexer em |
|---|---|
| divisão Propriedades × Cabos (arrasto) | `setupPropSectionResize` (app.js) — grava `__dccpRightSplit`; altura de cada um |
| recolher/expandir de um cartão | `bindSectionCollapse` + `animateSectionCollapse` (app.js) e `.collapsed` no macos.css |
| estética da barra de topo | bloco **"Barra de topo — estilo plano"**, no fim do macos.css (vence por vir depois) |
| busca da barra | `searchableItems`, `searchListHtml`, `renderTopSearchResults` (app.js) + `#topSearchWrap` no index.html |
| lista de cabos (linha, botão excluir) | `renderCables` em js/cables.js |
| nome do rack com a fileira (A-101) | `rackDisplayName` / `findRackByLabel` em js/geometry.js |
| exportar/importar planilha | js/inventory-import.js, `exportAssetsXLSX` (app.js), `exportCablesXLSX` (js/cables.js) |
| rotas e metragem do cabo | js/routing.js |
| ocupação de U / choque de posição | js/occupancy.js |
| salvar na nuvem e status | js/cloud-sync.js (`setCloudStatus`) |
| minimapa, zoom e barra inferior | `setupPan`, `setupMinimap`, `.canvas-zoom-bar` / `.heat-control` |

## 5. Estado e persistência

- `state` (js/state.js) guarda: `rows`, `racks`, `trays`, `cables`, `assets`, `rooms` (cada sala com `data`),
  catálogos, `selected` / `multiSelected` / `trayMultiSelected` e as medidas padrão (U, largura, profundidade…).
- O projeto vive na nuvem: `save()` (app.js) agenda o envio e a sala ativa é copiada para `room.data` por
  `syncActiveRoom()`.
- Chaves de `localStorage` usadas: `dc-planner-v6`, `dc-planner-heat-mode`, `dc-planner-env-advanced`, `dccp_hint_dismissed` (mais `dccp-collapse-<painel>` e `dccp-split-cabos`).

## 6. index.html — pontos de montagem

| marco | linha |
|---|---|
| topbar | 389 |
| sidebar left | 668 |
| sidebar right | 1039 |
| canvasWrap | 908 |
| heatControl | 913 |
| quickSearchModal | 1209 |

Ids (401) e suas linhas estão no fim deste arquivo, na seção 8.

## 7. CSS

### Seções do tema (macos.css)

- Stratum — camada de identidade visual "Console Óptico" — linha 1
- Busca geral na barra de topo — linha 471
- Tipografia de painel e barras laterais — linha 625
- Cabeçalho: topbar e barra da planta — linha 704
- Controles flutuantes sobre a planta — linha 1087
- Ajuda — linha 1152
- Barra inferior da planta: zoom, camadas e exportar — linha 1249
- Editor de cadastro (modelos): sheet em dois passos numerados — linha 1518
- Aba Propriedades: cabeçalho contextual e painel do cabo — linha 1961
- Aba Propriedades: painel do rack — linha 2363
- Racks na planta: faceplate de metal anodizado — linha 3191
- Barra de topo — estilo plano (referência do cliente) — linha 3373

Regras com `:not(#\9)` (truque de especificidade para vencer o app.css): linhas
34, 37, 51, 59, 64, 68, 77, 83, 86, 91, 95, 100, 101, 102, 108, 109, 110, 115, 125, 130, 136, 737, 746, 969, 2692, 2698, 3408, 3409, 3412, 3415, ….

## 8. Ids do index.html

`authScreen` 42 · `authTheme` 45 · `authLoginView` 60 · `loginForm` 63 · `loginEmail` 66 · `loginPassword` 75 · `loginError` 93 · `btnLogin` 94

`showSignup` 99 · `showForgot` 101 · `btnGuestMode` 106 · `authSignupView` 110 · `signupForm` 113 · `signupEmail` 116 · `signupPassword` 125 · `signupPassword2` 147

`signupMessage` 166 · `btnSignup` 167 · `showLoginFromSignup` 172 · `authForgotView` 177 · `forgotForm` 182 · `forgotEmail` 185 · `forgotMessage` 191 · `btnForgot` 192

`showLoginFromForgot` 197 · `authResetView` 202 · `resetForm` 205 · `resetPassword` 209 · `resetPassword2` 230 · `resetMessage` 248 · `btnResetPassword` 252 · `authLoading` 258

`dashboardScreen` 264 · `dashboardUserEmail` 278 · `dashboardTheme` 280 · `dashboardLogout` 285 · `dashboardNewProject` 298 · `projectsSearch` 311 · `projectsSort` 318 · `projectsSortBtn` 330

`projectsViewList` 351 · `projectsViewGrid` 361 · `projectsGrid` 374 · `projectsEmpty` 375 · `dashboardNewProjectEmpty` 383 · `mainTopbar` 389 · `sidebarToggle` 399 · `btnUndo` 412

`btnRedo` 422 · `btnTheme` 434 · `btnProjects` 446 · `topSearchWrap` 458 · `topSearch` 464 · `topSearchResults` 475 · `locationSelect` 484 · `locationSelectBtn` 491

`roomSelect` 506 · `roomSelectBtn` 513 · `btnLocations` 526 · `autosaveLabel` 539 · `autosaveToggle` 542 · `cloudStatus` 550 · `btnSave` 556 · `btnImportProject` 566

`btnExport` 576 · `btnPdfReport` 586 · `btnAddTray` 597 · `btnAssets` 602 · `btnCatalogs` 612 · `btnAlertsCenter` 622 · `alertsCenterCount` 631 · `btnHelp` 633

`userMenuBtn` 637 · `userAvatar` 644 · `authUserEmail` 649 · `btnLogout` 651 · `projectInput` 660 · `envCollapse` 681 · `btnReset` 694 · `projectName` 707

`rowCount` 715 · `defaultRacks` 726 · `rackUnits` 738 · `envAdvancedToggle` 745 · `envAdvanced` 756 · `rackWidth` 763 · `rackDepth` 774 · `rackGap` 786

`rackPowerCapacity` 801 · `rackWeightCapacity` 816 · `defaultRowGap` 827 · `lastUToTray` 838 · `defaultSlack` 849 · `btnBuildRows` 856 · `rowsCollapse` 877 · `rowsSearch` 897

`rowsPanel` 904 · `canvasWrap` 908 · `canvasStage` 909 · `layout` 910 · `heatControl` 913 · `btnExportPlant` 929 · `plantExportMenu` 932 · `structureLock` 938

`structureLockIcon` 944 · `heatLegend` 951 · `canvasZoomBar` 954 · `zoomOut` 959 · `zoomRange` 970 · `zoomIn` 980 · `zoomReset` 991 · `zoomFit` 1000

`rackTooltip` 1011 · `canvasEmptyHint` 1012 · `canvasEmptyHintClose` 1015 · `canvasEmptyHintHelp` 1028 · `minimap` 1034 · `minimapSvg` 1035 · `propHeadIcon` 1043 · `propHeadTitle` 1045

`propHeadSubtitle` 1046 · `propCollapse` 1052 · `propTitleSticky` 1064 · `properties` 1066 · `propSectionResize` 1071 · `cablesCollapse` 1088 · `cableCount` 1100 · `btnAddCablePanel` 1102

`btnImport` 1114 · `btnTemplate` 1125 · `btnExportCables` 1136 · `excelInput` 1147 · `cablesSelectAll` 1158 · `cablesSearch` 1163 · `cablesFilter` 1170 · `cablesFilterBtn` 1181

`cablesBulkBar` 1193 · `cablesBulkCount` 1194 · `cablesBulkDelete` 1197 · `cablesBulkClear` 1201 · `cablesList` 1205 · `quickSearchModal` 1209 · `quickSearchTitle` 1224 · `quickSearchClose` 1228

`quickSearchInput` 1239 · `quickSearchResults` 1245 · `projectSummaryModal` 1255 · `projectSummaryTitle` 1277 · `summaryProjectName` 1278 · `summaryClose` 1281 · `projectSummaryGrid` 1289 · `toast` 1292

`assetsModal` 1294 · `assetsTitle` 1311 · `assetsBulk` 1315 · `assetsExport` 1320 · `assetsNew` 1325 · `assetsClose` 1330 · `assetsKpiRow` 1338 · `assetsSearch` 1343

`assetsFilterBar` 1349 · `assetsClearFilters` 1467 · `assetsAttentionBanner` 1475 · `assetsAttentionClear` 1479 · `assetsBulkBar` 1485 · `assetsSelectedCount` 1486 · `assetsBulkStatus` 1488 · `assetsBulkSubstatus` 1490

`assetsBulkLocation` 1492 · `assetsBulkDelete` 1495 · `assetsBulkClear` 1500 · `assetsTableHead` 1506 · `assetsSelectAll` 1510 · `assetsList` 1852 · `assetsSelectedCountFooter` 1856 · `assetsPageSize` 1860

`assetsPageRange` 1867 · `assetsPageButtons` 1870 · `assetHistoryModal` 1876 · `assetHistoryTitle` 1894 · `assetHistorySubtitle` 1895 · `assetHistoryExport` 1902 · `assetHistoryClose` 1912 · `assetHistoryAssetName` 1932

`assetHistoryUser` 1945 · `assetHistoryLocation` 1957 · `assetHistoryStatusIcon` 1961 · `assetHistoryStatus` 1969 · `assetHistorySearch` 1981 · `assetHistoryType` 1988 · `assetHistoryField` 1993 · `assetHistoryDate` 1998

`assetHistoryRange` 2002 · `assetHistoryDateFrom` 2006 · `assetHistoryDateTo` 2014 · `assetHistoryCount` 2020 · `assetHistoryList` 2022 · `assetCatalogModal` 2028 · `assetCatalogTitle` 2046 · `assetCatalogClose` 2054

`catalogTypeSearch` 2113 · `catalogTypes` 2119 · `catalogCableTypeAdd` 2161 · `catalogCableTypeSearch` 2169 · `catalogCableTypes` 2175 · `catalogManufacturerSearch` 2227 · `catalogManufacturers` 2233 · `catalogModelAdd` 2276

`catalogModelSearch` 2284 · `catalogModelType` 2292 · `catalogModelManufacturer` 2296 · `catalogModels` 2301 · `catalogStatusSearch` 2350 · `catalogStatuses` 2356 · `catalogSubstatusSearch` 2408 · `catalogSubstatuses` 2414

`catalogLocationSearch` 2439 · `catalogLocationAdd` 2448 · `catalogLocations` 2453 · `locationsFooter` 2456 · `locationsFooterStats` 2457 · `catalogImportFile` 2468 · `assetsImportFile` 2469 · `assetsImportModal` 2471

`assetsImportTitle` 2488 · `assetsImportClose` 2495 · `assetsImportDrop` 2503 · `assetsImportChoose` 2513 · `assetsImportTemplate` 2532 · `assetsImportFileInfo` 2542 · `assetsImportMapping` 2544 · `assetsImportBack` 2548

`assetsImportCancel` 2555 · `assetsImportContinue` 2558 · `importPreviewModal` 2570 · `importPreviewTitle` 2588 · `importPreviewSubtitle` 2589 · `importPreviewClose` 2594 · `importPreviewSummary` 2602 · `importPreviewErrors` 2604

`importPreviewTable` 2607 · `importPreviewFooterStats` 2610 · `importPreviewCancel` 2613 · `importPreviewConfirm` 2616 · `importPreviewConfirmLabel` 2625 · `catalogEditorModal` 2631 · `catalogEditorTitle` 2649 · `catalogEditorSubtitle` 2650

`catalogEditorClose` 2656 · `catalogEditorKind` 2664 · `catalogEditorId` 2665 · `catalogStepBasic` 2668 · `catalogStepBasicTitle` 2671 · `catalogStepBasicHint` 2672 · `catalogEditorNameLabel` 2678 · `catalogEditorName` 2682

`catalogEditorTypeWrap` 2690 · `catalogEditorType` 2696 · `catalogEditorManufacturerWrap` 2701 · `catalogEditorManufacturer` 2707 · `catalogEditorPowerWrap` 2712 · `catalogEditorPowerW` 2716 · `catalogEditorWeightWrap` 2728 · `catalogEditorWeightKg` 2732

`catalogEditorPortsWrap` 2747 · `catalogPortDefsList` 2756 · `catalogPortDefsTotal` 2757 · `portRangeStart` 2775 · `portRangeEnd` 2783 · `portRangePoe` 2791 · `portRangeAdd` 2795 · `portSingleName` 2823

`portSinglePoe` 2830 · `portSingleAdd` 2834 · `catalogEditorHelpText` 2849 · `catalogEditorCancel` 2855 · `catalogEditorSave` 2860 · `catalogEditorSaveLabel` 2864 · `assetsBulkModal` 2869 · `assetsBulkTitle` 2884

`assetsBulkClose` 2888 · `assetsBulkChooser` 2896 · `assetsBulkManual` 2903 · `assetsBulkImport` 2921 · `assetsBulkEditor` 2940 · `assetsBulkAddRow` 2950 · `assetsBulkSummary` 2952 · `assetsBulkBody` 3010

`assetsBulkBack` 3014 · `assetsBulkCancel` 3018 · `assetsBulkSave` 3020 · `assetEditModal` 3028 · `assetEditTitle` 3044 · `assetEditHistory` 3051 · `assetEditCancelTop` 3058 · `assetEditNav` 3068

`assetEditContent` 3106 · `assetEditForm` 3107 · `assetEditId` 3108 · `assetStepDados` 3109 · `assetName` 3129 · `assetTag` 3147 · `assetSerial` 3157 · `assetLocation` 3172

`assetRack` 3180 · `assetUStart` 3188 · `assetUHeight` 3203 · `assetFace` 3221 · `assetStepEspec` 3239 · `assetType` 3255 · `assetManufacturer` 3264 · `assetModel` 3273

`assetStatus` 3287 · `assetSubstatus` 3297 · `assetPowerW` 3306 · `assetWeightKg` 3321 · `assetStepPortas` 3331 · `assetPortsExport` 3341 · `assetPortsAdd` 3351 · `assetPortsCount` 3360

`assetPortsUsedCount` 3362 · `assetPortsToggle` 3367 · `assetPortsList` 3378 · `assetStepCiclo` 3386 · `assetLifecycleBadge` 3394 · `assetPurchaseDate` 3405 · `assetWarrantyExpiration` 3414 · `assetEndOfLife` 3422

`assetNotes` 3427 · `assetNotesCount` 3431 · `assetEditCancel` 3438 · `bayfaceModal` 3449 · `bayfaceTitle` 3466 · `bayfaceClose` 3470 · `bayfaceContent` 3478 · `bayfaceAssetPickerModal` 3482

`bayfaceAssetPickerTitle` 3502 · `bayfaceAssetPickerSubtitle` 3503 · `bayfaceAssetPickerClose` 3508 · `bayfaceAssetPickerSearch` 3522 · `bayfaceAssetPickerCount` 3528 · `bayfaceAssetPickerList` 3545 · `bayfaceAssetPickerRange` 3548 · `bayfaceAssetPickerPrev` 3551

`bayfaceAssetPickerPage` 3558 · `bayfaceAssetPickerNext` 3560 · `renameRowModal` 3571 · `renameRowTitle` 3586 · `renameCancelTop` 3590 · `renameRowId` 3598 · `renamePrefix` 3602 · `renameStart` 3608

`renamePad` 3617 · `renamePreview` 3629 · `renameRowError` 3630 · `renameCancel` 3632 · `renameApply` 3633 · `uiConfirmModal` 3639 · `uiConfirmIcon` 3647 · `uiConfirmTitle` 3657

`uiConfirmSubtitle` 3658 · `uiConfirmBody` 3661 · `uiConfirmPromptWrap` 3662 · `uiConfirmPromptLabel` 3666 · `uiConfirmPromptInput` 3669 · `uiConfirmPromptError` 3670 · `uiConfirmCancel` 3673 · `uiConfirmOk` 3676

`roomEditorModal` 3682 · `roomEditorTitle` 3697 · `roomEditorClose` 3701 · `roomEditorForm` 3709 · `roomEditorId` 3710 · `roomEditorName` 3711 · `roomEditorCooling` 3716 · `roomEditorThermalReadout` 3722

`roomEditorCancel` 3729 · `helpModal` 3739 · `helpTitle` 3755 · `helpClose` 3759 · `pdfReportOptionsModal` 3967 · `pdfReportOptionsTitle` 3985 · `pdfReportOptionsClose` 3989 · `pdfReportOptionsForm` 3997

`pdfOptPlant` 4000 · `pdfOptSummary` 4005 · `pdfOptStatus` 4010 · `pdfOptLifecycle` 4015 · `pdfOptCables` 4020 · `pdfRacksSelectAll` 4032 · `pdfRacksSelectNone` 4038 · `pdfRacksList` 4044

`pdfReportOptionsCancel` 4047 · `cableTypeReviewModal` 4055 · `cableTypeReviewTitle` 4073 · `cableTypeReviewClose` 4080 · `cableTypeReviewList` 4092 · `cableTypeReviewCancel` 4094 · `cableTypeReviewConfirm` 4097 · `taskBar` 4107

`taskBarLabel` 4114

## 9. Testes e verificação

- `node --test "js/test/*.test.mjs"` — 8 arquivos de teste,
  cobrindo geometria, rota, ocupação, utilitários, versões e exportação da planta.
- `node scripts/bump-version.mjs css` — sobe a versão dos módulos e do CSS em index.html (cache do navegador).
- `cmd /c "node --input-type=module --check < app.js"` — checagem de sintaxe do app.js.
- `node scripts/system-map.mjs` — regenera este arquivo.

### Como eu meço mudanças de UI

Para qualquer mudança visual, subo o app no Edge headless com CDP (perfil temporário,
`--allow-file-access-from-files`), entro pelo modo convidado (`#btnGuestMode`), monto uma
estrutura pelo formulário (`rowCount` + `defaultRacks` + `#btnBuildRows` → `#uiConfirmOk`) e
meço o DOM (`getBoundingClientRect`) em vez de julgar pelo olho. Os scripts de medição ficam em
`%TEMP%\stratum-measure\*`. Para o tema claro, gravo `dc-planner-theme-v3=light` e recarrego.
