# SYSTEM-MAP — mapa do projeto

Gerado por `node scripts/system-map.mjs`. **Rode o script depois de mexer no código** para o
mapa continuar valendo (ele lê as linhas de verdade, não é escrito à mão).

Última geração: 2026-09-21 16:55 · app.js com 4473 linhas · 16 módulos em js/ · app.css 11161 · macos.css 3594

## 1. O que é o quê

| arquivo | papel |
|---|---|
| index.html | casca: barra de topo, duas laterais flutuantes, canvas, barra inferior e todos os modais |
| app.js | orquestra tudo: estado, render, interação do canvas e das laterais (`4473` linhas) |
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

`updateRoomUI` (68) · `updateStructureControls` (128) · `updateHistoryButtons` (243) · `updateRenamePreview` (1009) · `updateHeatControl` (1071) · `renderRoomSummary` (1269) · `render` (1306) · `updateAlertsCenterBadge` (1718) · `updateAssetUFieldsState` (1874) · `refreshAssetRackOptions` (1902) · `renderAssetPortsEditor` (1941) · `updateAssetLifecycleBadge` (2057) · `updateAssetNotesCount` (2070) · `renderAssetsTableHead` (2296) · `renderAssetsKpis` (2350) · `renderAssetsFilterBar` (2367) · `renderAssetsPagination` (2376) · `renderAssetsTableSort` (2418) · `updateAssetsBulkBar` (2425) · `renderAssetsList` (2509) · `renderBayfaceAssetPicker` (2596) · `fitBayfaceHeight` (2752) · `renderBayface` (2823) · `renderProperties` (2939) · `renderPropertiesBody` (2950) · `refreshCableValidation` (3154) · `updateCableAssetNameField` (3166) · `renderCableProperties` (3192) · `updateCableResult` (3345) · `renderManualRouteUI` (3369) · `refreshVisuals` (3379) · `updateCanvasEmptyHint` (3418) · `renderAll` (3423) · `updateProjectSummary` (3831) · `renderQuickSearchResults` (3890) · `renderTopSearchResults` (3904) · `centerOnPoint` (3939) · `updateMinimap` (4020)

### Ligações de UI (setup/bind)

`bindRowPanelActions` (626) · `bindRowReorder` (740) · `bindSectionCollapse` (871) · `setupFocusMode` (942) · `setupSummaryRefit` (1098) · `setupEnvAdvanced` (1106) · `setupPlantExport` (1129) · `setupHeatControl` (1137) · `setupRackTooltip` (1176) · `bindAssetColumnResize` (2243) · `bindPropPanel` (2886) · `setupPropCards` (2935) · `bindCablePanelSections` (3320) · `bindManualRouteControls` (3363) · `setupPropSectionResize` (3492) · `setupPan` (3631) · `bindTopSearch` (3919) · `setupMinimap` (4081) · `setupSidebarToggle` (4134) · `setupStructureLockControl` (4156) · `bind` (4168)

### Criação e edição de dados

`applyRoomData` (40) · `applyTheme` (170) · `addRow` (572) · `removeRackReferences` (581) · `resizeRow` (588) · `deleteRow` (608) · `addRowFromPanel` (662) · `applyRenameRow` (1021) · `createIndependentTray` (1051) · `deleteAsset` (2161) · `applyAssetColumnWidths` (2239) · `assignBayfaceAsset` (2651) · `deleteSelectedTrays` (3465) · `deleteSelectedRacks` (3479)

### Busca

`rowMatchesSearch` (636) · `searchableItems` (3840) · `searchListHtml` (3885) · `renderQuickSearchResults` (3890) · `closeTopSearch` (3899) · `renderTopSearchResults` (3904) · `clearTopSearch` (3918) · `bindTopSearch` (3919) · `activateSearchResult` (3947) · `openQuickSearch` (3990) · `closeQuickSearch` (3991)

### Cálculos (geometria/rota)

`rowAddButtonHtml` (619) · `rowMatchesSearch` (636) · `computeStats` (1063) · `rackTooltipHtml` (1158)

### Cascas e modais

`addRowFromPanel` (662) · `buildRowsPanel` (670) · `openRenameRowModal` (955) · `closeRenameRowModal` (972) · `openRenameRowsModal` (974) · `closeAlertsCenterPanel` (1777) · `openAlertsCenterPanel` (1778) · `openAssetModal` (2016) · `closeAssetModal` (2056) · `openAssetsModal` (2565) · `closeAssetsModal` (2566) · `bindPropPanel` (2886) · `openHelpModal` (3984) · `closeHelpModal` (3985)

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
| quickSearchModal | 1212 |

Ids (404) e suas linhas estão no fim deste arquivo, na seção 8.

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
- Aba Propriedades: cabeçalho contextual e painel do cabo — linha 1967
- Aba Propriedades: painel do rack — linha 2369
- Racks na planta: faceplate de metal anodizado — linha 3197
- Barra de topo — estilo plano (referência do cliente) — linha 3379

Regras com `:not(#\9)` (truque de especificidade para vencer o app.css): linhas
34, 37, 51, 59, 64, 68, 77, 83, 86, 91, 95, 100, 101, 102, 108, 109, 110, 115, 125, 130, 136, 737, 746, 969, 2698, 2704, 3414, 3415, 3418, 3421, ….

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

`cablesBulkBar` 1193 · `cablesBulkCount` 1197 · `cablesBulkClear` 1201 · `cablesBulkDelete` 1203 · `cablesList` 1208 · `quickSearchModal` 1212 · `quickSearchTitle` 1227 · `quickSearchClose` 1231

`quickSearchInput` 1242 · `quickSearchResults` 1248 · `projectSummaryModal` 1258 · `projectSummaryTitle` 1280 · `summaryProjectName` 1281 · `summaryClose` 1284 · `projectSummaryGrid` 1292 · `toast` 1295

`assetsModal` 1297 · `assetsTitle` 1314 · `assetsBulk` 1318 · `assetsExport` 1323 · `assetsNew` 1328 · `assetsClose` 1333 · `assetsKpiRow` 1341 · `assetsSearch` 1346

`assetsFilterBar` 1352 · `assetsClearFilters` 1470 · `assetsAttentionBanner` 1478 · `assetsAttentionClear` 1482 · `assetsBulkBar` 1488 · `assetsSelectedCount` 1492 · `assetsBulkStatus` 1497 · `assetsBulkStatusBtn` 1501

`assetsBulkSubstatus` 1517 · `assetsBulkSubstatusBtn` 1521 · `assetsBulkLocation` 1539 · `assetsBulkLocationBtn` 1543 · `assetsBulkClear` 1561 · `assetsBulkDelete` 1563 · `assetsTableHead` 1569 · `assetsSelectAll` 1573

`assetsList` 1915 · `assetsSelectedCountFooter` 1919 · `assetsPageSize` 1923 · `assetsPageRange` 1930 · `assetsPageButtons` 1933 · `assetHistoryModal` 1939 · `assetHistoryTitle` 1957 · `assetHistorySubtitle` 1958

`assetHistoryExport` 1965 · `assetHistoryClose` 1975 · `assetHistoryAssetName` 1995 · `assetHistoryUser` 2008 · `assetHistoryLocation` 2020 · `assetHistoryStatusIcon` 2024 · `assetHistoryStatus` 2032 · `assetHistorySearch` 2044

`assetHistoryType` 2051 · `assetHistoryField` 2056 · `assetHistoryDate` 2061 · `assetHistoryRange` 2065 · `assetHistoryDateFrom` 2069 · `assetHistoryDateTo` 2077 · `assetHistoryCount` 2083 · `assetHistoryList` 2085

`assetCatalogModal` 2091 · `assetCatalogTitle` 2109 · `assetCatalogClose` 2117 · `catalogTypeSearch` 2176 · `catalogTypes` 2182 · `catalogCableTypeAdd` 2224 · `catalogCableTypeSearch` 2232 · `catalogCableTypes` 2238

`catalogManufacturerSearch` 2290 · `catalogManufacturers` 2296 · `catalogModelAdd` 2339 · `catalogModelSearch` 2347 · `catalogModelType` 2355 · `catalogModelManufacturer` 2359 · `catalogModels` 2364 · `catalogStatusSearch` 2413

`catalogStatuses` 2419 · `catalogSubstatusSearch` 2471 · `catalogSubstatuses` 2477 · `catalogLocationSearch` 2502 · `catalogLocationAdd` 2511 · `catalogLocations` 2516 · `locationsFooter` 2519 · `locationsFooterStats` 2520

`catalogImportFile` 2531 · `assetsImportFile` 2532 · `assetsImportModal` 2534 · `assetsImportTitle` 2551 · `assetsImportClose` 2558 · `assetsImportDrop` 2566 · `assetsImportChoose` 2576 · `assetsImportTemplate` 2595

`assetsImportFileInfo` 2605 · `assetsImportMapping` 2607 · `assetsImportBack` 2611 · `assetsImportCancel` 2618 · `assetsImportContinue` 2621 · `importPreviewModal` 2633 · `importPreviewTitle` 2651 · `importPreviewSubtitle` 2652

`importPreviewClose` 2657 · `importPreviewSummary` 2665 · `importPreviewErrors` 2667 · `importPreviewTable` 2670 · `importPreviewFooterStats` 2673 · `importPreviewCancel` 2676 · `importPreviewConfirm` 2679 · `importPreviewConfirmLabel` 2688

`catalogEditorModal` 2694 · `catalogEditorTitle` 2712 · `catalogEditorSubtitle` 2713 · `catalogEditorClose` 2719 · `catalogEditorKind` 2727 · `catalogEditorId` 2728 · `catalogStepBasic` 2731 · `catalogStepBasicTitle` 2734

`catalogStepBasicHint` 2735 · `catalogEditorNameLabel` 2741 · `catalogEditorName` 2745 · `catalogEditorTypeWrap` 2753 · `catalogEditorType` 2759 · `catalogEditorManufacturerWrap` 2764 · `catalogEditorManufacturer` 2770 · `catalogEditorPowerWrap` 2775

`catalogEditorPowerW` 2779 · `catalogEditorWeightWrap` 2791 · `catalogEditorWeightKg` 2795 · `catalogEditorPortsWrap` 2810 · `catalogPortDefsList` 2819 · `catalogPortDefsTotal` 2820 · `portRangeStart` 2838 · `portRangeEnd` 2846

`portRangePoe` 2854 · `portRangeAdd` 2858 · `portSingleName` 2886 · `portSinglePoe` 2893 · `portSingleAdd` 2897 · `catalogEditorHelpText` 2912 · `catalogEditorCancel` 2918 · `catalogEditorSave` 2923

`catalogEditorSaveLabel` 2927 · `assetsBulkModal` 2932 · `assetsBulkTitle` 2947 · `assetsBulkClose` 2951 · `assetsBulkChooser` 2959 · `assetsBulkManual` 2966 · `assetsBulkImport` 2984 · `assetsBulkEditor` 3003

`assetsBulkAddRow` 3013 · `assetsBulkSummary` 3015 · `assetsBulkBody` 3073 · `assetsBulkBack` 3077 · `assetsBulkCancel` 3081 · `assetsBulkSave` 3083 · `assetEditModal` 3091 · `assetEditTitle` 3107

`assetEditHistory` 3114 · `assetEditCancelTop` 3121 · `assetEditNav` 3131 · `assetEditContent` 3169 · `assetEditForm` 3170 · `assetEditId` 3171 · `assetStepDados` 3172 · `assetName` 3192

`assetTag` 3210 · `assetSerial` 3220 · `assetLocation` 3235 · `assetRack` 3243 · `assetUStart` 3251 · `assetUHeight` 3266 · `assetFace` 3284 · `assetStepEspec` 3302

`assetType` 3318 · `assetManufacturer` 3327 · `assetModel` 3336 · `assetStatus` 3350 · `assetSubstatus` 3360 · `assetPowerW` 3369 · `assetWeightKg` 3384 · `assetStepPortas` 3394

`assetPortsExport` 3404 · `assetPortsAdd` 3414 · `assetPortsCount` 3423 · `assetPortsUsedCount` 3425 · `assetPortsToggle` 3430 · `assetPortsList` 3441 · `assetStepCiclo` 3449 · `assetLifecycleBadge` 3457

`assetPurchaseDate` 3468 · `assetWarrantyExpiration` 3477 · `assetEndOfLife` 3485 · `assetNotes` 3490 · `assetNotesCount` 3494 · `assetEditCancel` 3501 · `bayfaceModal` 3512 · `bayfaceTitle` 3529

`bayfaceClose` 3533 · `bayfaceContent` 3541 · `bayfaceAssetPickerModal` 3545 · `bayfaceAssetPickerTitle` 3565 · `bayfaceAssetPickerSubtitle` 3566 · `bayfaceAssetPickerClose` 3571 · `bayfaceAssetPickerSearch` 3585 · `bayfaceAssetPickerCount` 3591

`bayfaceAssetPickerList` 3608 · `bayfaceAssetPickerRange` 3611 · `bayfaceAssetPickerPrev` 3614 · `bayfaceAssetPickerPage` 3621 · `bayfaceAssetPickerNext` 3623 · `renameRowModal` 3634 · `renameRowTitle` 3649 · `renameCancelTop` 3653

`renameRowId` 3661 · `renamePrefix` 3665 · `renameStart` 3671 · `renamePad` 3680 · `renamePreview` 3692 · `renameRowError` 3693 · `renameCancel` 3695 · `renameApply` 3696

`uiConfirmModal` 3702 · `uiConfirmIcon` 3710 · `uiConfirmTitle` 3720 · `uiConfirmSubtitle` 3721 · `uiConfirmBody` 3724 · `uiConfirmPromptWrap` 3725 · `uiConfirmPromptLabel` 3729 · `uiConfirmPromptInput` 3732

`uiConfirmPromptError` 3733 · `uiConfirmCancel` 3736 · `uiConfirmOk` 3739 · `roomEditorModal` 3745 · `roomEditorTitle` 3760 · `roomEditorClose` 3764 · `roomEditorForm` 3772 · `roomEditorId` 3773

`roomEditorName` 3774 · `roomEditorCooling` 3779 · `roomEditorThermalReadout` 3785 · `roomEditorCancel` 3792 · `helpModal` 3802 · `helpTitle` 3818 · `helpClose` 3822 · `pdfReportOptionsModal` 4030

`pdfReportOptionsTitle` 4048 · `pdfReportOptionsClose` 4052 · `pdfReportOptionsForm` 4060 · `pdfOptPlant` 4063 · `pdfOptSummary` 4068 · `pdfOptStatus` 4073 · `pdfOptLifecycle` 4078 · `pdfOptCables` 4083

`pdfRacksSelectAll` 4095 · `pdfRacksSelectNone` 4101 · `pdfRacksList` 4107 · `pdfReportOptionsCancel` 4110 · `cableTypeReviewModal` 4118 · `cableTypeReviewTitle` 4136 · `cableTypeReviewClose` 4143 · `cableTypeReviewList` 4155

`cableTypeReviewCancel` 4157 · `cableTypeReviewConfirm` 4160 · `taskBar` 4170 · `taskBarLabel` 4177

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
