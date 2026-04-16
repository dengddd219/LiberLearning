/**
 * LiberStudy Figma Lo-Fi Wireframe Generator
 *
 * 使用方法：
 * 1. 在 Figma 中按 Ctrl+/ (或 Cmd+/)，搜索 "Plugins"
 * 2. 选择 "Development" → "Open Console"（或直接 Plugins → Development → New Plugin → Run code）
 * 3. 粘贴此脚本并运行
 *
 * 生成内容：
 * - Frame 1: 大厅工作台 (Lobby Workspace) — 1440×900px
 * - Frame 2: 课中采集界面 (In-Class Recording) — 1440×900px
 * - Component A: 药丸型笔记切换控件 — 独立展示
 *
 * 规范：
 * - 1440px 桌面端画布，8px 栅格
 * - shadcn/ui 标准尺寸（h-10=40px，h-8=32px，h-12=48px）
 * - Tailwind 色板映射
 * - lucide-react 图标占位符（文字标注）
 */

// ============================================================
// 颜色常量（Tailwind 色板）
// ============================================================
const C = {
  white:       { r: 1,    g: 1,    b: 1    },  // #FFFFFF bg-white
  gray50:      { r: 0.976, g: 0.980, b: 0.984 }, // #F9FAFB bg-gray-50
  gray100:     { r: 0.945, g: 0.953, b: 0.961 }, // #F1F5F9
  gray200:     { r: 0.898, g: 0.914, b: 0.933 }, // #E5E7EB border-gray-200
  gray300:     { r: 0.820, g: 0.839, b: 0.859 }, // #D1D5DB bg-gray-300
  gray400:     { r: 0.612, g: 0.639, b: 0.686 }, // #9CA3AF text-gray-400
  gray500:     { r: 0.420, g: 0.451, b: 0.502 }, // #6B7280 text-gray-500
  gray700:     { r: 0.216, g: 0.255, b: 0.318 }, // #374151 text-gray-700
  gray900:     { r: 0.067, g: 0.090, b: 0.129 }, // #111827 text-gray-900
  black:       { r: 0,    g: 0,    b: 0    },  // #000000
  cream:       { r: 0.980, g: 0.976, b: 0.969 }, // #FAF9F7 药丸容器
  blue500:     { r: 0.235, g: 0.510, b: 0.965 }, // #3B82F6 accent
  blue50:      { r: 0.937, g: 0.961, b: 1    },  // #EFF6FF
  warn:        { r: 1,    g: 0.851, b: 0.200 },  // warning yellow
};

// ============================================================
// 工具函数
// ============================================================

function rgb(c, a = 1) {
  return [{ type: 'SOLID', color: c, opacity: a }];
}

function createRect(name, x, y, w, h, fill, strokeColor = null) {
  const rect = figma.createRectangle();
  rect.name = name;
  rect.x = x; rect.y = y;
  rect.resize(w, h);
  rect.fills = rgb(fill);
  if (strokeColor) {
    rect.strokes = rgb(strokeColor);
    rect.strokeWeight = 1;
    rect.strokeAlign = 'INSIDE';
  }
  return rect;
}

function createText(content, x, y, fontSize, color, fontWeight = 'Regular') {
  const text = figma.createText();
  text.x = x; text.y = y;
  text.characters = content;
  text.fontSize = fontSize;
  text.fills = rgb(color);
  return text;
}

async function loadFonts() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
}

function createFrame(name, x, y, w, h, fill = C.white) {
  const frame = figma.createFrame();
  frame.name = name;
  frame.x = x; frame.y = y;
  frame.resize(w, h);
  frame.fills = rgb(fill);
  return frame;
}

function createLabel(text, x, y, w, h, bg, textColor, fontSize = 12) {
  const frame = createFrame(text, x, y, w, h, bg);
  frame.strokes = rgb(C.gray200);
  frame.strokeWeight = 1;
  frame.strokeAlign = 'INSIDE';
  const t = figma.createText();
  t.characters = text;
  t.fontSize = fontSize;
  t.fills = rgb(textColor);
  t.textAlignHorizontal = 'CENTER';
  t.textAlignVertical = 'CENTER';
  t.resize(w, h);
  frame.appendChild(t);
  return frame;
}

// 图标占位符：灰色方块 + 图标名称文字
function createIconPlaceholder(iconName, x, y, size = 20) {
  const g = figma.createFrame();
  g.name = `icon:${iconName}`;
  g.x = x; g.y = y;
  g.resize(size, size);
  g.fills = rgb(C.gray200);
  g.cornerRadius = 2;
  const t = figma.createText();
  t.characters = iconName.substring(0, 2).toUpperCase();
  t.fontSize = 8;
  t.fills = rgb(C.gray500);
  t.textAlignHorizontal = 'CENTER';
  t.textAlignVertical = 'CENTER';
  t.resize(size, size);
  g.appendChild(t);
  return g;
}

// 垂直分隔符（w-px h-5 bg-gray-300）
function createDivider(x, y) {
  const d = createRect('divider', x, y, 1, 20, C.gray300);
  return d;
}

// 标准按钮（h-10 = 40px）
function createButton(label, x, y, w, variant = 'primary') {
  const bg = variant === 'primary' ? C.black : C.white;
  const tc = variant === 'primary' ? C.white : C.gray700;
  const frame = createFrame(`btn:${label}`, x, y, w, 40, bg);
  frame.cornerRadius = 6;
  if (variant !== 'primary') {
    frame.strokes = rgb(C.gray200);
    frame.strokeWeight = 1;
    frame.strokeAlign = 'INSIDE';
  }
  const t = figma.createText();
  t.characters = label;
  t.fontSize = 14;
  t.fontName = { family: "Inter", style: "Medium" };
  t.fills = rgb(tc);
  t.textAlignHorizontal = 'CENTER';
  t.textAlignVertical = 'CENTER';
  t.resize(w, 40);
  frame.appendChild(t);
  return frame;
}

// 卡片容器（带边框和圆角）
function createCard(name, x, y, w, h) {
  const card = createFrame(name, x, y, w, h, C.white);
  card.strokes = rgb(C.gray200);
  card.strokeWeight = 1;
  card.strokeAlign = 'INSIDE';
  card.cornerRadius = 8;
  return card;
}

// ============================================================
// FRAME 1: 大厅工作台 (Lobby Workspace)
// 1440 × 900px
// 布局：左侧边栏 240px + 右侧主区 1200px
// ============================================================

async function buildLobbyFrame(offsetX = 0) {
  const FRAME_W = 1440, FRAME_H = 900;
  const SIDEBAR_W = 240;
  const CONTENT_X = SIDEBAR_W;
  const CONTENT_W = FRAME_W - SIDEBAR_W;

  const root = createFrame('🏠 界面1：大厅工作台 (Lobby Workspace)', offsetX, 0, FRAME_W, FRAME_H, C.white);

  // ── 左侧边栏 ──────────────────────────────────────────────
  const sidebar = createFrame('sidebar', 0, 0, SIDEBAR_W, FRAME_H, C.gray50);
  sidebar.strokes = rgb(C.gray200);
  sidebar.strokeWeight = 1;
  sidebar.strokeAlign = 'OUTSIDE';

  // 顶部 Logo 区域
  const logoArea = createFrame('logo-area', 0, 0, SIDEBAR_W, 64, C.gray50);
  const logoT = figma.createText();
  logoT.characters = 'LiberStudy';
  logoT.fontSize = 18;
  logoT.fontName = { family: "Inter", style: "Bold" };
  logoT.fills = rgb(C.gray900);
  logoT.x = 20; logoT.y = 22;
  logoArea.appendChild(logoT);
  sidebar.appendChild(logoArea);

  // 分隔线
  sidebar.appendChild(createRect('divider-h', 0, 64, SIDEBAR_W, 1, C.gray200));

  // 快捷搜索栏 (Ctrl+K)
  const searchBar = createFrame('search-bar', 12, 76, SIDEBAR_W - 24, 36, C.white);
  searchBar.cornerRadius = 6;
  searchBar.strokes = rgb(C.gray200);
  searchBar.strokeWeight = 1;
  searchBar.strokeAlign = 'INSIDE';
  const searchIcon = createIconPlaceholder('Search', 10, 8, 16);
  searchBar.appendChild(searchIcon);
  const searchT = figma.createText();
  searchT.characters = '搜索课程... Ctrl+K';
  searchT.fontSize = 13;
  searchT.fills = rgb(C.gray400);
  searchT.x = 34; searchT.y = 10;
  searchBar.appendChild(searchT);
  sidebar.appendChild(searchBar);

  // 主要操作按钮
  const newClassBtn = createButton('＋ 新建课堂', 12, 124, SIDEBAR_W - 24, 'primary');
  sidebar.appendChild(newClassBtn);

  const recBtn = createFrame('btn:start-recording', 12, 172, SIDEBAR_W - 24, 40, C.blue50);
  recBtn.cornerRadius = 6;
  recBtn.strokes = rgb({ r: 0.147, g: 0.451, b: 0.914 });
  recBtn.strokeWeight = 1;
  recBtn.strokeAlign = 'INSIDE';
  const recT = figma.createText();
  recT.characters = '🎙️ 开始录音';
  recT.fontSize = 14;
  recT.fontName = { family: "Inter", style: "Medium" };
  recT.fills = rgb(C.blue500);
  recT.textAlignHorizontal = 'CENTER';
  recT.textAlignVertical = 'CENTER';
  recT.resize(SIDEBAR_W - 24, 40);
  recBtn.appendChild(recT);
  sidebar.appendChild(recBtn);

  // 分隔线
  sidebar.appendChild(createRect('divider-h2', 12, 228, SIDEBAR_W - 24, 1, C.gray200));

  // 我的课程区
  const myCoursesLabel = figma.createText();
  myCoursesLabel.characters = '我的课程';
  myCoursesLabel.fontSize = 11;
  myCoursesLabel.fills = rgb(C.gray400);
  myCoursesLabel.fontName = { family: "Inter", style: "Medium" };
  myCoursesLabel.x = 20; myCoursesLabel.y = 244;
  sidebar.appendChild(myCoursesLabel);

  // 课程文件夹列表
  const courses = [
    { name: '📁 MSBA 7028', active: true },
    { name: '📁 商业分析导论', active: false },
    { name: '📁 数据结构', active: false },
    { name: '📁 经济学原理', active: false },
  ];

  courses.forEach((course, i) => {
    const itemY = 268 + i * 36;
    const itemBg = course.active ? C.gray200 : C.gray50;
    const itemFrame = createFrame(`course:${course.name}`, 8, itemY, SIDEBAR_W - 16, 32, itemBg);
    itemFrame.cornerRadius = 6;
    const itemT = figma.createText();
    itemT.characters = course.name;
    itemT.fontSize = 14;
    itemT.fills = rgb(course.active ? C.gray900 : C.gray700);
    itemT.x = 12; itemT.y = 8;
    itemFrame.appendChild(itemT);
    sidebar.appendChild(itemFrame);
  });

  // 新建课程按钮
  const newFolderBtn = createFrame('btn:new-folder', 12, 420, SIDEBAR_W - 24, 32, C.gray50);
  newFolderBtn.cornerRadius = 6;
  newFolderBtn.strokes = rgb(C.gray200);
  newFolderBtn.strokeWeight = 1;
  newFolderBtn.strokeAlign = 'INSIDE';
  const nfT = figma.createText();
  nfT.characters = '＋ 新建课程';
  nfT.fontSize = 13;
  nfT.fills = rgb(C.gray500);
  nfT.x = 12; nfT.y = 8;
  newFolderBtn.appendChild(nfT);
  sidebar.appendChild(newFolderBtn);

  // 底部：设置 + 用户信息
  sidebar.appendChild(createRect('divider-bottom', 0, FRAME_H - 72, SIDEBAR_W, 1, C.gray200));
  const bottomArea = createFrame('bottom-area', 0, FRAME_H - 71, SIDEBAR_W, 71, C.gray50);
  // 用户头像占位
  const avatar = createRect('avatar', 16, 16, 40, 40, C.gray300);
  avatar.cornerRadius = 20;
  bottomArea.appendChild(avatar);
  const userT = figma.createText();
  userT.characters = '小林';
  userT.fontSize = 14;
  userT.fontName = { family: "Inter", style: "Medium" };
  userT.fills = rgb(C.gray900);
  userT.x = 64; userT.y = 14;
  bottomArea.appendChild(userT);
  const quotaT = figma.createText();
  quotaT.characters = '今日剩余：1/2 节课';
  quotaT.fontSize = 12;
  quotaT.fills = rgb(C.gray500);
  quotaT.x = 64; quotaT.y = 34;
  bottomArea.appendChild(quotaT);
  const settingsIcon = createIconPlaceholder('Settings', SIDEBAR_W - 36, 20, 20);
  bottomArea.appendChild(settingsIcon);
  sidebar.appendChild(bottomArea);

  root.appendChild(sidebar);

  // ── 右侧主内容区 ──────────────────────────────────────────
  const content = createFrame('main-content', CONTENT_X, 0, CONTENT_W, FRAME_H, C.white);

  // 顶部导航栏
  const topBar = createFrame('top-bar', 0, 0, CONTENT_W, 64, C.white);
  topBar.strokes = rgb(C.gray200);
  topBar.strokeWeight = 1;
  topBar.strokeAlign = 'OUTSIDE';

  const pageTitle = figma.createText();
  pageTitle.characters = 'MSBA 7028';
  pageTitle.fontSize = 20;
  pageTitle.fontName = { family: "Inter", style: "Bold" };
  pageTitle.fills = rgb(C.gray900);
  pageTitle.x = 32; pageTitle.y = 20;
  topBar.appendChild(pageTitle);

  // Grid/List 分段控制器（右上角）
  const segmented = createFrame('segmented-control', CONTENT_W - 112, 18, 96, 32, C.gray100);
  segmented.cornerRadius = 8;
  // Grid 选项（激活）
  const gridOpt = createFrame('opt:grid', 2, 2, 44, 28, C.white);
  gridOpt.cornerRadius = 6;
  const gridIcon = createIconPlaceholder('Grid', 12, 6, 16);
  gridOpt.appendChild(gridIcon);
  // List 选项
  const listOpt = createFrame('opt:list', 50, 2, 44, 28, C.gray100);
  listOpt.cornerRadius = 6;
  const listIcon = createIconPlaceholder('List', 12, 6, 16);
  listOpt.appendChild(listIcon);
  segmented.appendChild(gridOpt);
  segmented.appendChild(listOpt);
  topBar.appendChild(segmented);
  content.appendChild(topBar);

  // 网格内容区
  const gridArea = createFrame('grid-area', 0, 64, CONTENT_W, FRAME_H - 64, C.white);

  // 顶部统计行
  const statsT = figma.createText();
  statsT.characters = '共 8 节课  ·  最近访问：2026-04-12';
  statsT.fontSize = 13;
  statsT.fills = rgb(C.gray500);
  statsT.x = 32; statsT.y = 24;
  gridArea.appendChild(statsT);

  // 网格卡片（4列布局，列宽约 264px，间距 24px）
  const CARD_W = 256, CARD_H = 200;
  const CARD_GAP = 24;
  const GRID_PADDING = 32;
  const cardData = [
    { title: 'MSBA 7028 第3讲', duration: '1小时 12分', notes: '18页笔记', date: '2026-04-12', status: 'done' },
    { title: 'MSBA 7028 第2讲', duration: '1小时 05分', notes: '15页笔记', date: '2026-04-10', status: 'done' },
    { title: 'MSBA 7028 第1讲', duration: '58分', notes: '12页笔记', date: '2026-04-08', status: 'done' },
    { title: 'MSBA 7028 第4讲', duration: '处理中...', notes: '—', date: '2026-04-13', status: 'loading' },
  ];

  cardData.forEach((card, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const cx = GRID_PADDING + col * (CARD_W + CARD_GAP);
    const cy = 64 + row * (CARD_H + CARD_GAP);

    const cardFrame = createCard(`card:${card.title}`, cx, cy, CARD_W, CARD_H);

    if (card.status === 'loading') {
      // 骨架屏效果
      const skeleton = createRect('skeleton-thumb', 0, 0, CARD_W, 120, C.gray100);
      skeleton.cornerRadius = 8;
      cardFrame.appendChild(skeleton);
      const loadT = figma.createText();
      loadT.characters = '解析中...';
      loadT.fontSize = 13;
      loadT.fills = rgb(C.gray400);
      loadT.x = 16; loadT.y = 136;
      cardFrame.appendChild(loadT);
      // 进度条
      const progressBg = createRect('progress-bg', 16, 160, CARD_W - 32, 4, C.gray200);
      progressBg.cornerRadius = 2;
      cardFrame.appendChild(progressBg);
      const progressFill = createRect('progress-fill', 16, 160, (CARD_W - 32) * 0.6, 4, C.gray700);
      progressFill.cornerRadius = 2;
      cardFrame.appendChild(progressFill);
    } else {
      // PPT 封面占位
      const thumb = createRect('thumb', 0, 0, CARD_W, 128, C.gray100);
      thumb.cornerRadius = 8;
      cardFrame.appendChild(thumb);
      const thumbT = figma.createText();
      thumbT.characters = 'PPT 封面预览';
      thumbT.fontSize = 12;
      thumbT.fills = rgb(C.gray400);
      thumbT.textAlignHorizontal = 'CENTER';
      thumbT.resize(CARD_W, 128);
      thumbT.y = 56;
      cardFrame.appendChild(thumbT);

      // 卡片信息区
      const titleT = figma.createText();
      titleT.characters = card.title;
      titleT.fontSize = 14;
      titleT.fontName = { family: "Inter", style: "Medium" };
      titleT.fills = rgb(C.gray900);
      titleT.x = 16; titleT.y = 140;
      cardFrame.appendChild(titleT);

      const metaT = figma.createText();
      metaT.characters = `${card.duration}  ·  ${card.notes}`;
      metaT.fontSize = 12;
      metaT.fills = rgb(C.gray500);
      metaT.x = 16; metaT.y = 162;
      cardFrame.appendChild(metaT);

      const dateT = figma.createText();
      dateT.characters = card.date;
      dateT.fontSize = 12;
      dateT.fills = rgb(C.gray400);
      dateT.x = 16; dateT.y = 178;
      cardFrame.appendChild(dateT);
    }

    gridArea.appendChild(cardFrame);
  });

  content.appendChild(gridArea);
  root.appendChild(content);

  return root;
}

// ============================================================
// FRAME 2: 课中采集界面 - 模式 A（有 PPT 三栏布局）
// 1440 × 900px
// 布局：左栏 200px + 中栏弹性 + 右栏 320px
// ============================================================

async function buildInClassFrame(offsetX = 1500) {
  const FRAME_W = 1440, FRAME_H = 900;
  const LEFT_W = 200;
  const RIGHT_W = 320;
  const MID_W = FRAME_W - LEFT_W - RIGHT_W; // 920px
  const MID_X = LEFT_W;
  const RIGHT_X = LEFT_W + MID_W;

  const root = createFrame('📝 界面2：课中采集界面（有PPT模式）', offsetX, 0, FRAME_W, FRAME_H, C.white);

  // ── 左栏：大纲导航 ────────────────────────────────────────
  const leftCol = createFrame('left-outline', 0, 0, LEFT_W, FRAME_H, C.gray50);
  leftCol.strokes = rgb(C.gray200);
  leftCol.strokeWeight = 1;
  leftCol.strokeAlign = 'OUTSIDE';

  const outlineTitle = figma.createText();
  outlineTitle.characters = '大纲导航';
  outlineTitle.fontSize = 12;
  outlineTitle.fontName = { family: "Inter", style: "Medium" };
  outlineTitle.fills = rgb(C.gray500);
  outlineTitle.x = 16; outlineTitle.y = 16;
  leftCol.appendChild(outlineTitle);

  // PPT 缩略图列表
  const slideNames = [
    '1. 课程介绍与大纲', '2. 市场分析框架', '3. 竞争态势分析',
    '4. 用户研究方法论', '5. 数据采集与处理', '6. 可视化最佳实践',
    '7. 案例分析：美团', '8. 案例分析：滴滴', '9. 策略制定框架',
  ];
  slideNames.forEach((name, i) => {
    const isActive = i === 2;
    const itemBg = isActive ? C.blue50 : C.gray50;
    const thumbFrame = createFrame(`slide-thumb:${i+1}`, 8, 44 + i * 68, LEFT_W - 16, 60, C.white);
    thumbFrame.cornerRadius = 4;
    thumbFrame.strokes = rgb(isActive ? { r: 0.147, g: 0.451, b: 0.914 } : C.gray200);
    thumbFrame.strokeWeight = isActive ? 2 : 1;
    thumbFrame.strokeAlign = 'INSIDE';

    // 缩略图占位
    const thumbImg = createRect('thumb-img', 0, 0, LEFT_W - 16, 44, isActive ? C.blue50 : C.gray100);
    thumbImg.cornerRadius = 4;
    thumbFrame.appendChild(thumbImg);

    const pageNumT = figma.createText();
    pageNumT.characters = `${i+1}. ${name.split('. ')[1]}`;
    pageNumT.fontSize = 11;
    pageNumT.fills = rgb(isActive ? C.blue500 : C.gray500);
    pageNumT.x = 4; pageNumT.y = 46;
    thumbFrame.appendChild(pageNumT);

    leftCol.appendChild(thumbFrame);
  });

  root.appendChild(leftCol);

  // ── 中栏：PPT 画布 ────────────────────────────────────────
  const midCol = createFrame('mid-canvas', MID_X, 0, MID_W, FRAME_H, C.gray50);

  // 工具栏（h-12 = 48px，PDF 阅读器风格）
  const toolbar = createFrame('toolbar', 0, 0, MID_W, 48, C.gray50);
  toolbar.strokes = rgb(C.gray200);
  toolbar.strokeWeight = 1;
  toolbar.strokeAlign = 'OUTSIDE';

  let tbX = 12;

  // ① 导航：PanelLeft
  const panelLeftIcon = createIconPlaceholder('PanelLeft', tbX, 14, 20);
  toolbar.appendChild(panelLeftIcon);
  tbX += 28;

  // 分隔符
  toolbar.appendChild(createRect('div1', tbX, 14, 1, 20, C.gray300));
  tbX += 9;

  // ② 批注工具
  const annotTools = [
    { icon: 'Highlighter', label: '高亮' },
    { icon: 'Pen', label: '绘制' },
    { icon: 'Eraser', label: '橡皮' },
    { icon: 'Type', label: '文本' },
  ];
  annotTools.forEach(tool => {
    const iconPh = createIconPlaceholder(tool.icon, tbX, 14, 20);
    toolbar.appendChild(iconPh);
    if (tool.label === '高亮' || tool.label === '绘制') {
      // ChevronDown
      const chevronPh = createIconPlaceholder('Chev', tbX + 22, 18, 12);
      toolbar.appendChild(chevronPh);
      tbX += 38;
    } else {
      tbX += 28;
    }
  });

  // 分隔符
  toolbar.appendChild(createRect('div2', tbX, 14, 1, 20, C.gray300));
  tbX += 9;

  // ③ 辅助功能
  toolbar.appendChild(createIconPlaceholder('Volume2', tbX, 14, 20));
  tbX += 28;
  toolbar.appendChild(createIconPlaceholder('Languages', tbX, 14, 20));
  tbX += 28;

  // 分隔符
  toolbar.appendChild(createRect('div3', tbX, 14, 1, 20, C.gray300));
  tbX += 9;

  // ④ 缩放
  toolbar.appendChild(createIconPlaceholder('Minus', tbX, 14, 20));
  tbX += 28;
  toolbar.appendChild(createIconPlaceholder('Plus', tbX, 14, 20));
  tbX += 28;
  toolbar.appendChild(createIconPlaceholder('Maximize2', tbX, 14, 20));
  tbX += 28;

  // 分隔符
  toolbar.appendChild(createRect('div4', tbX, 14, 1, 20, C.gray300));
  tbX += 9;

  // ⑤ 页码（居中）
  const pageInputBg = createRect('page-input', tbX, 12, 40, 24, C.white);
  pageInputBg.cornerRadius = 4;
  pageInputBg.strokes = rgb(C.gray300);
  pageInputBg.strokeWeight = 1;
  pageInputBg.strokeAlign = 'INSIDE';
  toolbar.appendChild(pageInputBg);
  const pageNum = figma.createText();
  pageNum.characters = '3';
  pageNum.fontSize = 13;
  pageNum.fills = rgb(C.gray900);
  pageNum.textAlignHorizontal = 'CENTER';
  pageNum.resize(40, 24);
  pageNum.x = tbX;
  pageNum.y = 12;
  toolbar.appendChild(pageNum);
  tbX += 48;
  const totalPages = figma.createText();
  totalPages.characters = '/ 19';
  totalPages.fontSize = 13;
  totalPages.fills = rgb(C.gray500);
  totalPages.x = tbX; totalPages.y = 17;
  toolbar.appendChild(totalPages);
  tbX += 36;

  // 分隔符
  toolbar.appendChild(createRect('div5', tbX, 14, 1, 20, C.gray300));
  tbX += 9;

  // ⑥ 页面视图
  toolbar.appendChild(createIconPlaceholder('RotateCw', tbX, 14, 20));
  tbX += 28;
  toolbar.appendChild(createIconPlaceholder('BookOpen', tbX, 14, 20));
  tbX += 28;

  // ⑦ 右对齐操作（ml-auto）
  const rightToolsX = MID_W - 176;
  toolbar.appendChild(createRect('div-r', rightToolsX - 9, 14, 1, 20, C.gray300));
  const rightIcons = ['Search', 'Printer', 'Save', 'SaveAll', 'Maximize', 'Settings'];
  rightIcons.forEach((icon, i) => {
    toolbar.appendChild(createIconPlaceholder(icon, rightToolsX + i * 28, 14, 20));
  });

  midCol.appendChild(toolbar);

  // PPT 主画布区（垂直滚动，当前显示第3页）
  const pptCanvas = createFrame('ppt-canvas', 0, 48, MID_W, FRAME_H - 48, C.gray100);

  // PPT 页面（16:9 比例，在中栏居中）
  const PPT_W = MID_W - 80, PPT_H = PPT_W * 9 / 16;
  const pptSlide = createCard('ppt-slide-3', 40, 32, PPT_W, PPT_H);

  // PPT 内容占位
  const pptBg = createRect('slide-bg', 0, 0, PPT_W, PPT_H, C.white);
  pptSlide.appendChild(pptBg);

  // PPT 内容文字
  const slideTitle = figma.createText();
  slideTitle.characters = '3. 竞争态势分析';
  slideTitle.fontSize = 28;
  slideTitle.fontName = { family: "Inter", style: "Bold" };
  slideTitle.fills = rgb(C.gray900);
  slideTitle.x = 48; slideTitle.y = 40;
  pptSlide.appendChild(slideTitle);

  const bullets = [
    '• 波特五力模型应用',
    '• 主要竞争对手：美团、饿了么、京东到家',
    '• 差异化竞争策略分析',
    '• 市场份额变化趋势（2023-2025）',
  ];
  bullets.forEach((bullet, i) => {
    const bt = figma.createText();
    bt.characters = bullet;
    bt.fontSize = 18;
    bt.fills = rgb(C.gray700);
    bt.x = 48; bt.y = 100 + i * 40;
    pptSlide.appendChild(bt);
  });

  // 就地文本批注示例（用户点击后的状态）
  const annotation = createFrame('annotation:就地批注示例', 48, 248, 280, 32, { r: 1, g: 1, b: 0.8 });
  annotation.cornerRadius = 4;
  annotation.strokes = rgb({ r: 0.9, g: 0.8, b: 0.2 });
  annotation.strokeWeight = 1;
  annotation.strokeAlign = 'INSIDE';
  const annotT = figma.createText();
  annotT.characters = '📝 波特五力：记一下具体例子';
  annotT.fontSize = 13;
  annotT.fills = rgb(C.gray900);
  annotT.x = 8; annotT.y = 8;
  annotation.appendChild(annotT);
  pptSlide.appendChild(annotation);

  // 时间戳标注
  const tsLabel = figma.createText();
  tsLabel.characters = '⏱ 00:23:15';
  tsLabel.fontSize = 11;
  tsLabel.fills = rgb(C.gray400);
  tsLabel.x = 48; tsLabel.y = 284;
  pptSlide.appendChild(tsLabel);

  pptCanvas.appendChild(pptSlide);
  midCol.appendChild(pptCanvas);
  root.appendChild(midCol);

  // ── 右栏：动态笔记区 ──────────────────────────────────────
  const rightCol = createFrame('right-notes', RIGHT_X, 0, RIGHT_W, FRAME_H, C.white);
  rightCol.strokes = rgb(C.gray200);
  rightCol.strokeWeight = 1;
  rightCol.strokeAlign = 'OUTSIDE';

  // 录音控制条（固定顶部，h-16=64px）
  const recControl = createFrame('recording-control', 0, 0, RIGHT_W, 64, C.white);
  recControl.strokes = rgb(C.gray200);
  recControl.strokeWeight = 1;
  recControl.strokeAlign = 'OUTSIDE';

  // 录音状态圆点（红色，闪烁中）
  const recDot = createRect('rec-dot', 16, 22, 12, 12, { r: 0.937, g: 0.267, b: 0.267 });
  recDot.cornerRadius = 6;

  const recTimeT = figma.createText();
  recTimeT.characters = '00:23:15  录音中';
  recTimeT.fontSize = 14;
  recTimeT.fontName = { family: "Inter", style: "Medium" };
  recTimeT.fills = rgb(C.gray900);
  recTimeT.x = 36; recTimeT.y = 23;
  recControl.appendChild(recTimeT);

  // 录音控制按钮
  const pauseBtn = createFrame('btn:pause', RIGHT_W - 100, 16, 40, 32, C.gray100);
  pauseBtn.cornerRadius = 6;
  const pauseIcon = createIconPlaceholder('Pause', 10, 6, 20);
  pauseBtn.appendChild(pauseIcon);
  recControl.appendChild(pauseBtn);

  const stopBtn = createFrame('btn:stop', RIGHT_W - 52, 16, 40, 32, { r: 0.993, g: 0.929, b: 0.929 });
  stopBtn.cornerRadius = 6;
  stopBtn.strokes = rgb({ r: 0.937, g: 0.267, b: 0.267 });
  stopBtn.strokeWeight = 1;
  stopBtn.strokeAlign = 'INSIDE';
  const stopIcon = createIconPlaceholder('Stop', 10, 6, 20);
  stopBtn.appendChild(stopIcon);
  recControl.appendChild(stopBtn);
  recControl.appendChild(recDot);

  rightCol.appendChild(recControl);

  // 当前页标题
  const curPageLabel = figma.createText();
  curPageLabel.characters = '第 3 页：竞争态势分析';
  curPageLabel.fontSize = 13;
  curPageLabel.fontName = { family: "Inter", style: "Medium" };
  curPageLabel.fills = rgb(C.gray500);
  curPageLabel.x = 16; curPageLabel.y = 76;
  rightCol.appendChild(curPageLabel);

  rightCol.appendChild(createRect('div-notes', 0, 96, RIGHT_W, 1, C.gray200));

  // 笔记内容区
  const notesArea = createFrame('notes-area', 0, 97, RIGHT_W, FRAME_H - 97, C.white);

  // 同步的就地批注
  const note1 = createFrame('note:synced-annotation', 12, 16, RIGHT_W - 24, 48, { r: 1, g: 1, b: 0.9 });
  note1.cornerRadius = 6;
  note1.strokes = rgb({ r: 0.9, g: 0.8, b: 0.2 });
  note1.strokeWeight = 1;
  note1.strokeAlign = 'INSIDE';
  const n1Icon = figma.createText();
  n1Icon.characters = '📝 [00:23:15]';
  n1Icon.fontSize = 11;
  n1Icon.fills = rgb(C.gray500);
  n1Icon.x = 12; n1Icon.y = 8;
  note1.appendChild(n1Icon);
  const n1T = figma.createText();
  n1T.characters = '波特五力：记一下具体例子';
  n1T.fontSize = 14;
  n1T.fills = rgb(C.black);
  n1T.x = 12; n1T.y = 26;
  note1.appendChild(n1T);
  notesArea.appendChild(note1);

  // 空白输入提示
  const inputHintFrame = createFrame('note-input', 12, 76, RIGHT_W - 24, 80, C.gray50);
  inputHintFrame.cornerRadius = 6;
  inputHintFrame.strokes = rgb(C.gray200);
  inputHintFrame.strokeWeight = 1;
  inputHintFrame.strokeAlign = 'INSIDE';
  const inputHint = figma.createText();
  inputHint.characters = '在此处输入笔记，与 PPT 画布双向同步...\n\n支持 Markdown 格式';
  inputHint.fontSize = 13;
  inputHint.fills = rgb(C.gray400);
  inputHint.x = 12; inputHint.y = 12;
  inputHintFrame.appendChild(inputHint);
  notesArea.appendChild(inputHintFrame);

  rightCol.appendChild(notesArea);
  root.appendChild(rightCol);

  return root;
}

// ============================================================
// COMPONENT A: 药丸型笔记切换控件
// 独立展示，位于 Frame 3 区域
// ============================================================

async function buildPillComponent(offsetX = 3000) {
  const FRAME_W = 600, FRAME_H = 400;
  const root = createFrame('💊 组件A：药丸型笔记切换控件', offsetX, 0, FRAME_W, FRAME_H, C.gray50);

  // 标题说明
  const titleT = figma.createText();
  titleT.characters = '药丸型笔记切换控件 — 课后查看界面右栏顶部';
  titleT.fontSize = 14;
  titleT.fontName = { family: "Inter", style: "Medium" };
  titleT.fills = rgb(C.gray500);
  titleT.x = 24; titleT.y = 24;
  root.appendChild(titleT);

  // ── 药丸容器（无边框，暖灰背景 #FAF9F7）──────────────────
  const pillContainer = createFrame('pill-container', 24, 60, 320, 44, C.cream);
  pillContainer.cornerRadius = 22;

  // 左分段：我的笔记（非激活态，与容器同色）
  const leftSeg = createFrame('seg:my-notes', 4, 4, 148, 36, C.cream);
  leftSeg.cornerRadius = 18;
  const listIcon = createIconPlaceholder('List', 12, 8, 20);
  leftSeg.appendChild(listIcon);
  const myNotesT = figma.createText();
  myNotesT.characters = '我的笔记';
  myNotesT.fontSize = 14;
  myNotesT.fills = rgb(C.gray700);
  myNotesT.x = 40; myNotesT.y = 10;
  leftSeg.appendChild(myNotesT);
  pillContainer.appendChild(leftSeg);

  // 右分段：AI 笔记（激活态，纯白背景 + 微阴影）
  const rightSeg = createFrame('seg:ai-notes [ACTIVE]', 156, 4, 160, 36, C.white);
  rightSeg.cornerRadius = 18;
  // 微阴影效果（用边框模拟）
  rightSeg.strokes = rgb(C.gray200);
  rightSeg.strokeWeight = 1;
  rightSeg.strokeAlign = 'INSIDE';
  rightSeg.effects = [{
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.08 },
    offset: { x: 0, y: 2 },
    radius: 8,
    spread: 0,
    visible: true,
    blendMode: 'NORMAL',
  }];

  // Sparkles 图标
  const sparklesIcon = createIconPlaceholder('Sparkles', 12, 8, 20);
  rightSeg.appendChild(sparklesIcon);
  const aiNotesT = figma.createText();
  aiNotesT.characters = 'AI 笔记';
  aiNotesT.fontSize = 14;
  aiNotesT.fontName = { family: "Inter", style: "Medium" };
  aiNotesT.fills = rgb(C.gray900);
  aiNotesT.x = 40; aiNotesT.y = 10;
  rightSeg.appendChild(aiNotesT);
  // ChevronDown 图标
  const chevIcon = createIconPlaceholder('ChevronDown', 128, 12, 14);
  rightSeg.appendChild(chevIcon);

  pillContainer.appendChild(rightSeg);
  root.appendChild(pillContainer);

  // ── AI 笔记模板下拉菜单（半透明卡片）────────────────────
  const dropdownLabel = figma.createText();
  dropdownLabel.characters = '↓ 点击 ChevronDown 展开的模板下拉菜单';
  dropdownLabel.fontSize = 12;
  dropdownLabel.fills = rgb(C.gray400);
  dropdownLabel.x = 24; dropdownLabel.y = 116;
  root.appendChild(dropdownLabel);

  const dropdown = createCard('dropdown-menu', 175, 128, 280, 220);
  dropdown.effects = [{
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.12 },
    offset: { x: 0, y: 4 },
    radius: 16,
    spread: 0,
    visible: true,
    blendMode: 'NORMAL',
  }];

  const templates = [
    { name: '✓ 基于我的笔记扩写', active: true },
    { name: '  全 PPT 讲解笔记', active: false },
    { name: '  完整综合笔记', active: false },
    { name: '  大纲摘要', active: false },
  ];

  templates.forEach((tmpl, i) => {
    const itemBg = tmpl.active ? C.gray50 : C.white;
    const item = createFrame(`template:${tmpl.name}`, 4, 4 + i * 52, 272, 48, itemBg);
    item.cornerRadius = 6;
    const itemT = figma.createText();
    itemT.characters = tmpl.name;
    itemT.fontSize = 14;
    itemT.fontName = tmpl.active ? { family: "Inter", style: "Medium" } : { family: "Inter", style: "Regular" };
    itemT.fills = rgb(tmpl.active ? C.gray900 : C.gray700);
    itemT.x = 16; itemT.y = 16;
    item.appendChild(itemT);
    dropdown.appendChild(item);
  });

  root.appendChild(dropdown);

  // ── 粒度切换说明 ──────────────────────────────────────────
  const granularityLabel = figma.createText();
  granularityLabel.characters = '粒度切换：';
  granularityLabel.fontSize = 12;
  granularityLabel.fills = rgb(C.gray500);
  granularityLabel.x = 24; granularityLabel.y = 356;
  root.appendChild(granularityLabel);

  const granSeg = createFrame('granularity-control', 96, 348, 160, 36, C.gray100);
  granSeg.cornerRadius = 8;
  const simpleOpt = createFrame('opt:simple', 2, 2, 76, 32, C.white);
  simpleOpt.cornerRadius = 6;
  simpleOpt.strokes = rgb(C.gray200);
  simpleOpt.strokeWeight = 1;
  simpleOpt.strokeAlign = 'INSIDE';
  const simpleT = figma.createText();
  simpleT.characters = '简单';
  simpleT.fontSize = 13;
  simpleT.fontName = { family: "Inter", style: "Medium" };
  simpleT.fills = rgb(C.gray900);
  simpleT.textAlignHorizontal = 'CENTER';
  simpleT.resize(76, 32);
  simpleOpt.appendChild(simpleT);
  granSeg.appendChild(simpleOpt);

  const detailOpt = createFrame('opt:detail', 82, 2, 76, 32, C.gray100);
  detailOpt.cornerRadius = 6;
  const detailT = figma.createText();
  detailT.characters = '详细';
  detailT.fontSize = 13;
  detailT.fills = rgb(C.gray500);
  detailT.textAlignHorizontal = 'CENTER';
  detailT.resize(76, 32);
  detailOpt.appendChild(detailT);
  granSeg.appendChild(detailOpt);
  root.appendChild(granSeg);

  return root;
}

// ============================================================
// 主执行入口
// ============================================================

async function main() {
  await loadFonts();

  //figma.showUI(__html__, { visible: false });

  try {
    console.log('🎨 开始生成 LiberStudy 低保真线框图...');

    // 生成 3 个界面（水平排列，间距 100px）
    const frame1 = await buildLobbyFrame(0);
    console.log('✅ 界面1：大厅工作台 生成完成');

    const frame2 = await buildInClassFrame(1540);
    console.log('✅ 界面2：课中采集界面 生成完成');

    const compA = await buildPillComponent(3080);
    console.log('✅ 组件A：药丸型切换控件 生成完成');

    // 全选并缩放视图
    figma.currentPage.selection = [frame1, frame2, compA];
    figma.viewport.scrollAndZoomIntoView([frame1, frame2, compA]);

    console.log('🎉 所有线框图生成完成！共 3 个对象已放入画布。');
    figma.notify('✅ LiberStudy 低保真线框图生成完成！3个界面已加入画布。', { timeout: 5000 });

  } catch (error) {
    console.error('❌ 生成失败:', error);
    figma.notify('❌ 生成失败，请查看控制台错误信息。', { error: true });
  }

  figma.closePlugin();
}

main();
