# SYSTEM-MAP — mapa do projeto

Gerado por `node scripts/system-map.mjs`. **Rode o script depois de mexer no código** para o
mapa continuar valendo (ele lê as linhas de verdade, não é escrito à mão).

Última geração: 2026-09-21 17:50 · app.js com 4473 linhas · 16 módulos em js/ · app.css 11311 · macos.css 3597

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
  cloud_sync_js --> geometry_js["geometry.js"]
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
| `js/cloud-sync.js` | 1227 | cloud:11, configureCloudSync:19, setCloudStatus:72, updatePlannerProjectName:91, assetLogDiff:134, recordAssetAudit:177, openAssetHistory:488, closeAssetHistory:525, … | utils.js, state.js, dialogs.js, styled-select.js, runtime.js, geometry.js |
| `js/dialogs.js` | 80 | uiConfirm:19, uiPrompt:44 | utils.js |
| `js/geometry.js` | 439 | VIEW_PAD:8, rowForRack:11, rackDisplayName:15, findRackByLabel:24, rowIndex:44, racksInRow:45, rackAt:46, makeRack:52, … | state.js, utils.js |
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
| topbar | 363 |
| sidebar left | 642 |
| sidebar right | 1013 |
| canvasWrap | 882 |
| heatControl | 887 |
| quickSearchModal | 1186 |

Ids (404) e suas linhas estão no fim deste arquivo, na seção 8.

## 7. CSS

### Seções do tema (macos.css)

- Stratum — camada de identidade visual "Console Óptico" — linha 1
- Busca geral na barra de topo — linha 474
- Tipografia de painel e barras laterais — linha 628
- Cabeçalho: topbar e barra da planta — linha 707
- Controles flutuantes sobre a planta — linha 1090
- Ajuda — linha 1155
- Barra inferior da planta: zoom, camadas e exportar — linha 1252
- Editor de cadastro (modelos): sheet em dois passos numerados — linha 1521
- Aba Propriedades: cabeçalho contextual e painel do cabo — linha 1970
- Aba Propriedades: painel do rack — linha 2372
- Racks na planta: faceplate de metal anodizado — linha 3200
- Barra de topo — estilo plano (referência do cliente) — linha 3382

Regras com `:not(#\9)` (truque de especificidade para vencer o app.css): linhas
34, 37, 51, 54, 62, 67, 71, 80, 86, 89, 94, 98, 103, 104, 105, 111, 112, 113, 118, 128, 133, 139, 740, 749, 972, 2701, 2707, 3417, 3418, 3421, ….

## 8. Ids do index.html

`authScreen` 42 · `authTheme` 45 · `authLoginView` 60 · `loginForm` 63 · `loginEmail` 66 · `loginPassword` 75 · `loginError` 93 · `btnLogin` 94

`showSignup` 99 · `showForgot` 101 · `btnGuestMode` 106 · `authSignupView` 110 · `signupForm` 113 · `signupEmail` 116 · `signupPassword` 125 · `signupPassword2` 147

`signupMessage` 166 · `btnSignup` 167 · `showLoginFromSignup` 172 · `authForgotView` 177 · `forgotForm` 182 · `forgotEmail` 185 · `forgotMessage` 191 · `btnForgot` 192

`showLoginFromForgot` 197 · `authResetView` 202 · `resetForm` 205 · `resetPassword` 209 · `resetPassword2` 230 · `resetMessage` 248 · `btnResetPassword` 252 · `authLoading` 258

`dashboardScreen` 264 · `dashboardUserEmail` 278 · `dashboardTheme` 280 · `dashboardLogout` 285 · `projectsSearch` 306 · `dashboardNewProject` 312 · `projectsSort` 318 · `projectsSortBtn` 330

`projectsSplit` 345 · `projectsGrid` 346 · `projectsPreview` 347 · `projectsEmpty` 349 · `dashboardNewProjectEmpty` 357 · `mainTopbar` 363 · `sidebarToggle` 373 · `btnUndo` 386

`btnRedo` 396 · `btnTheme` 408 · `btnProjects` 420 · `topSearchWrap` 432 · `topSearch` 438 · `topSearchResults` 449 · `locationSelect` 458 · `locationSelectBtn` 465

`roomSelect` 480 · `roomSelectBtn` 487 · `btnLocations` 500 · `autosaveLabel` 513 · `autosaveToggle` 516 · `cloudStatus` 524 · `btnSave` 530 · `btnImportProject` 540

`btnExport` 550 · `btnPdfReport` 560 · `btnAddTray` 571 · `btnAssets` 576 · `btnCatalogs` 586 · `btnAlertsCenter` 596 · `alertsCenterCount` 605 · `btnHelp` 607

`userMenuBtn` 611 · `userAvatar` 618 · `authUserEmail` 623 · `btnLogout` 625 · `projectInput` 634 · `envCollapse` 655 · `btnReset` 668 · `projectName` 681

`rowCount` 689 · `defaultRacks` 700 · `rackUnits` 712 · `envAdvancedToggle` 719 · `envAdvanced` 730 · `rackWidth` 737 · `rackDepth` 748 · `rackGap` 760

`rackPowerCapacity` 775 · `rackWeightCapacity` 790 · `defaultRowGap` 801 · `lastUToTray` 812 · `defaultSlack` 823 · `btnBuildRows` 830 · `rowsCollapse` 851 · `rowsSearch` 871

`rowsPanel` 878 · `canvasWrap` 882 · `canvasStage` 883 · `layout` 884 · `heatControl` 887 · `btnExportPlant` 903 · `plantExportMenu` 906 · `structureLock` 912

`structureLockIcon` 918 · `heatLegend` 925 · `canvasZoomBar` 928 · `zoomOut` 933 · `zoomRange` 944 · `zoomIn` 954 · `zoomReset` 965 · `zoomFit` 974

`rackTooltip` 985 · `canvasEmptyHint` 986 · `canvasEmptyHintClose` 989 · `canvasEmptyHintHelp` 1002 · `minimap` 1008 · `minimapSvg` 1009 · `propHeadIcon` 1017 · `propHeadTitle` 1019

`propHeadSubtitle` 1020 · `propCollapse` 1026 · `propTitleSticky` 1038 · `properties` 1040 · `propSectionResize` 1045 · `cablesCollapse` 1062 · `cableCount` 1074 · `btnAddCablePanel` 1076

`btnImport` 1088 · `btnTemplate` 1099 · `btnExportCables` 1110 · `excelInput` 1121 · `cablesSelectAll` 1132 · `cablesSearch` 1137 · `cablesFilter` 1144 · `cablesFilterBtn` 1155

`cablesBulkBar` 1167 · `cablesBulkCount` 1171 · `cablesBulkClear` 1175 · `cablesBulkDelete` 1177 · `cablesList` 1182 · `quickSearchModal` 1186 · `quickSearchTitle` 1201 · `quickSearchClose` 1205

`quickSearchInput` 1216 · `quickSearchResults` 1222 · `projectSummaryModal` 1232 · `projectSummaryTitle` 1254 · `summaryProjectName` 1255 · `summaryClose` 1258 · `projectSummaryGrid` 1266 · `toast` 1269

`assetsModal` 1271 · `assetsTitle` 1288 · `assetsBulk` 1292 · `assetsExport` 1297 · `assetsNew` 1302 · `assetsClose` 1307 · `assetsKpiRow` 1315 · `assetsSearch` 1320

`assetsFilterBar` 1326 · `assetsClearFilters` 1444 · `assetsAttentionBanner` 1452 · `assetsAttentionClear` 1456 · `assetsBulkBar` 1462 · `assetsSelectedCount` 1466 · `assetsBulkStatus` 1471 · `assetsBulkStatusBtn` 1475

`assetsBulkSubstatus` 1491 · `assetsBulkSubstatusBtn` 1495 · `assetsBulkLocation` 1513 · `assetsBulkLocationBtn` 1517 · `assetsBulkClear` 1535 · `assetsBulkDelete` 1537 · `assetsTableHead` 1543 · `assetsSelectAll` 1547

`assetsList` 1889 · `assetsSelectedCountFooter` 1893 · `assetsPageSize` 1897 · `assetsPageRange` 1904 · `assetsPageButtons` 1907 · `assetHistoryModal` 1913 · `assetHistoryTitle` 1931 · `assetHistorySubtitle` 1932

`assetHistoryExport` 1939 · `assetHistoryClose` 1949 · `assetHistoryAssetName` 1969 · `assetHistoryUser` 1982 · `assetHistoryLocation` 1994 · `assetHistoryStatusIcon` 1998 · `assetHistoryStatus` 2006 · `assetHistorySearch` 2018

`assetHistoryType` 2025 · `assetHistoryField` 2030 · `assetHistoryDate` 2035 · `assetHistoryRange` 2039 · `assetHistoryDateFrom` 2043 · `assetHistoryDateTo` 2051 · `assetHistoryCount` 2057 · `assetHistoryList` 2059

`assetCatalogModal` 2065 · `assetCatalogTitle` 2083 · `assetCatalogClose` 2091 · `catalogTypeSearch` 2150 · `catalogTypes` 2156 · `catalogCableTypeAdd` 2198 · `catalogCableTypeSearch` 2206 · `catalogCableTypes` 2212

`catalogManufacturerSearch` 2264 · `catalogManufacturers` 2270 · `catalogModelAdd` 2313 · `catalogModelSearch` 2321 · `catalogModelType` 2329 · `catalogModelManufacturer` 2333 · `catalogModels` 2338 · `catalogStatusSearch` 2387

`catalogStatuses` 2393 · `catalogSubstatusSearch` 2445 · `catalogSubstatuses` 2451 · `catalogLocationSearch` 2476 · `catalogLocationAdd` 2485 · `catalogLocations` 2490 · `locationsFooter` 2493 · `locationsFooterStats` 2494

`catalogImportFile` 2505 · `assetsImportFile` 2506 · `assetsImportModal` 2508 · `assetsImportTitle` 2525 · `assetsImportClose` 2532 · `assetsImportDrop` 2540 · `assetsImportChoose` 2550 · `assetsImportTemplate` 2569

`assetsImportFileInfo` 2579 · `assetsImportMapping` 2581 · `assetsImportBack` 2585 · `assetsImportCancel` 2592 · `assetsImportContinue` 2595 · `importPreviewModal` 2607 · `importPreviewTitle` 2625 · `importPreviewSubtitle` 2626

`importPreviewClose` 2631 · `importPreviewSummary` 2639 · `importPreviewErrors` 2641 · `importPreviewTable` 2644 · `importPreviewFooterStats` 2647 · `importPreviewCancel` 2650 · `importPreviewConfirm` 2653 · `importPreviewConfirmLabel` 2662

`catalogEditorModal` 2668 · `catalogEditorTitle` 2686 · `catalogEditorSubtitle` 2687 · `catalogEditorClose` 2693 · `catalogEditorKind` 2701 · `catalogEditorId` 2702 · `catalogStepBasic` 2705 · `catalogStepBasicTitle` 2708

`catalogStepBasicHint` 2709 · `catalogEditorNameLabel` 2715 · `catalogEditorName` 2719 · `catalogEditorTypeWrap` 2727 · `catalogEditorType` 2733 · `catalogEditorManufacturerWrap` 2738 · `catalogEditorManufacturer` 2744 · `catalogEditorPowerWrap` 2749

`catalogEditorPowerW` 2753 · `catalogEditorWeightWrap` 2765 · `catalogEditorWeightKg` 2769 · `catalogEditorPortsWrap` 2784 · `catalogPortDefsList` 2793 · `catalogPortDefsTotal` 2794 · `portRangeStart` 2812 · `portRangeEnd` 2820

`portRangePoe` 2828 · `portRangeAdd` 2832 · `portSingleName` 2860 · `portSinglePoe` 2867 · `portSingleAdd` 2871 · `catalogEditorHelpText` 2886 · `catalogEditorCancel` 2892 · `catalogEditorSave` 2897

`catalogEditorSaveLabel` 2901 · `assetsBulkModal` 2906 · `assetsBulkTitle` 2921 · `assetsBulkClose` 2925 · `assetsBulkChooser` 2933 · `assetsBulkManual` 2940 · `assetsBulkImport` 2958 · `assetsBulkEditor` 2977

`assetsBulkAddRow` 2987 · `assetsBulkSummary` 2989 · `assetsBulkBody` 3047 · `assetsBulkBack` 3051 · `assetsBulkCancel` 3055 · `assetsBulkSave` 3057 · `assetEditModal` 3065 · `assetEditTitle` 3081

`assetEditHistory` 3088 · `assetEditCancelTop` 3095 · `assetEditNav` 3105 · `assetEditContent` 3143 · `assetEditForm` 3144 · `assetEditId` 3145 · `assetStepDados` 3146 · `assetName` 3166

`assetTag` 3184 · `assetSerial` 3194 · `assetLocation` 3209 · `assetRack` 3217 · `assetUStart` 3225 · `assetUHeight` 3240 · `assetFace` 3258 · `assetStepEspec` 3276

`assetType` 3292 · `assetManufacturer` 3301 · `assetModel` 3310 · `assetStatus` 3324 · `assetSubstatus` 3334 · `assetPowerW` 3343 · `assetWeightKg` 3358 · `assetStepPortas` 3368

`assetPortsExport` 3378 · `assetPortsAdd` 3388 · `assetPortsCount` 3397 · `assetPortsUsedCount` 3399 · `assetPortsToggle` 3404 · `assetPortsList` 3415 · `assetStepCiclo` 3423 · `assetLifecycleBadge` 3431

`assetPurchaseDate` 3442 · `assetWarrantyExpiration` 3451 · `assetEndOfLife` 3459 · `assetNotes` 3464 · `assetNotesCount` 3468 · `assetEditCancel` 3475 · `bayfaceModal` 3486 · `bayfaceTitle` 3503

`bayfaceClose` 3507 · `bayfaceContent` 3515 · `bayfaceAssetPickerModal` 3519 · `bayfaceAssetPickerTitle` 3539 · `bayfaceAssetPickerSubtitle` 3540 · `bayfaceAssetPickerClose` 3545 · `bayfaceAssetPickerSearch` 3559 · `bayfaceAssetPickerCount` 3565

`bayfaceAssetPickerList` 3582 · `bayfaceAssetPickerRange` 3585 · `bayfaceAssetPickerPrev` 3588 · `bayfaceAssetPickerPage` 3595 · `bayfaceAssetPickerNext` 3597 · `renameRowModal` 3608 · `renameRowTitle` 3623 · `renameCancelTop` 3627

`renameRowId` 3635 · `renamePrefix` 3639 · `renameStart` 3645 · `renamePad` 3654 · `renamePreview` 3666 · `renameRowError` 3667 · `renameCancel` 3669 · `renameApply` 3670

`uiConfirmModal` 3676 · `uiConfirmIcon` 3684 · `uiConfirmTitle` 3694 · `uiConfirmSubtitle` 3695 · `uiConfirmBody` 3698 · `uiConfirmPromptWrap` 3699 · `uiConfirmPromptLabel` 3703 · `uiConfirmPromptInput` 3706

`uiConfirmPromptError` 3707 · `uiConfirmCancel` 3710 · `uiConfirmOk` 3713 · `roomEditorModal` 3719 · `roomEditorTitle` 3734 · `roomEditorClose` 3738 · `roomEditorForm` 3746 · `roomEditorId` 3747

`roomEditorName` 3748 · `roomEditorCooling` 3753 · `roomEditorThermalReadout` 3759 · `roomEditorCancel` 3766 · `helpModal` 3776 · `helpTitle` 3792 · `helpClose` 3796 · `pdfReportOptionsModal` 4004

`pdfReportOptionsTitle` 4022 · `pdfReportOptionsClose` 4026 · `pdfReportOptionsForm` 4034 · `pdfOptPlant` 4037 · `pdfOptSummary` 4042 · `pdfOptStatus` 4047 · `pdfOptLifecycle` 4052 · `pdfOptCables` 4057

`pdfRacksSelectAll` 4069 · `pdfRacksSelectNone` 4075 · `pdfRacksList` 4081 · `pdfReportOptionsCancel` 4084 · `cableTypeReviewModal` 4092 · `cableTypeReviewTitle` 4110 · `cableTypeReviewClose` 4117 · `cableTypeReviewList` 4129

`cableTypeReviewCancel` 4131 · `cableTypeReviewConfirm` 4134 · `taskBar` 4144 · `taskBarLabel` 4151

## 9. Testes e verificação

- `node --test "js/test/*.test.mjs"` — 9 arquivos de teste,
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
