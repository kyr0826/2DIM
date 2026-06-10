let video;
let bodyPose;
let poses = [];
let smoothedKeypoints = {};

let commonClassifier;
let dailyClassifier;

let currentLabel = "요일을 선택해주세요";
let activeModelName = "대기중";

let imgBody, imgShoulder, imgGlove, imgHelmet, imgSword;

let itemCount = 0;
let isDailyLoaded = false;
let isAppReady = false;

let commonItems = ["Wallet", "Phone"];

const dailyItemsMap = {
  Mon: ["SketchBook", "PencilCase", "pencilSharpener", "Fan"], // v
  Tue: ["TextBook", "IPad", "Perfume", "Bottle"],     // v
  Wed: ["Future", "Creative", "English", "Japanese"], // v
  Thu: ["Fan", "Reading", "Listening", "Pillcase"],   // v
  Fri: ["illustration", "N2", "Word", "SpringNote"],  // v
};

let dailyItems = [];
let selectedDay = "";
let foundItems = [];
let activeTargetInView = "";

let currentConfidence = 0;
let holdTime = 0;
const REQUIRED_TIME = 1000;

let isClassifying = false;

// ── UI 연출용 변수 ──────────────────────────────
let flashAlpha = 0;        // 아이템 획득 시 화면 플래시
let flashItemName = "";    // 획득된 아이템 이름 (중앙 팝업)
let flashTextAlpha = 0;    // 획득 텍스트 페이드

// ── 프레임 레이아웃 상수 ─────────────────────────
const FRAME_PAD = 20;      // 외곽 여백 (px)
const FRAME_R   = 24;      // 모서리 반지름

// 장비 아이콘 정의 (단계 순서대로)
const GEAR_ICONS = ["🛡", "🦾", "🧤", "🧤", "⛑", "⚔"];
const GEAR_LABELS = ["몸통", "견갑", "왼손", "오른손", "투구", "검"];

function preload() {
  bodyPose = ml5.bodyPose({ flipped: true });
  commonClassifier = ml5.imageClassifier('http://127.0.0.1:5500/Models/Common/model.json');

  imgBody     = loadImage('Images/BodyArmor.png');
  imgShoulder = loadImage('Images/Shoulder.png');
  imgGlove    = loadImage('Images/Hand.png');
  imgHelmet   = loadImage('Images/Hellmet.png');
  imgSword    = loadImage('Images/Sword.png');
}

function setup() {
  // 뷰포트 전체를 세로 거울로 사용
  let cnv = createCanvas(windowWidth, windowHeight);
  cnv.parent('canvas-wrap');

  video = createCapture(VIDEO, { flipped: true });
  // video.size(windowWidth, windowHeight);
  video.hide();

  bodyPose.detectStart(video, gotPoses);
  imageMode(CENTER);

  initDayButtons();

  setTimeout(() => {
    isAppReady = true;
    classifyVideo();
  }, 2000);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  //video.size(windowWidth, windowHeight);
}

function draw() {
  // ── 0. 배경: 외곽 영역을 어두운 색으로 채움 ──
  background(18, 18, 22);

  // ── 프레임 내부 영역 계산 ──
  let fx = FRAME_PAD;
  let fy = FRAME_PAD;
  let fw = width  - FRAME_PAD * 2;
  let fh = height - FRAME_PAD * 2;

  // ── 1. 둥근 클리핑 마스크로 카메라 렌더 ──
  push();
  // drawingContext는 p5의 내부 캔버스 2D 컨텍스트
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.roundRect(fx, fy, fw, fh, FRAME_R);
  drawingContext.clip();

  imageMode(CORNER);
  image(video, fx, fy, fw, fh);

  // 장비 오버레이 (클립 안에서)
  if (poses.length > 0) {
    let pose = poses[0];
    drawEquipment(mapPoseToFrame(pose));
  }

  // 획득 플래시 (프레임 안)
  if (flashAlpha > 0) {
    noStroke();
    fill(255, 220, 80, flashAlpha);
    rect(fx, fy, fw, fh);
    flashAlpha = max(0, flashAlpha - 8);
  }

  drawingContext.restore();
  pop();

  // ── 2. 프레임 테두리 + 외곽 그림자 효과 ──
  drawOuterFrame(fx, fy, fw, fh);

  checkLevelUp();

  // ── HUD 레이어 ──
  drawTopBar();        // 상단: 요일/모델 상태
  drawGearStrip();     // 우측: 장비 슬롯 스트립
  drawScanFeedback();  // 하단: 인식 피드백 + 게이지
  drawAcquirePopup();  // 중앙: 아이템 획득 팝업
}

// ────────────────────────────────────────────────
// 외곽 프레임 — 얇은 테두리 + 내측 그라디언트 비네트
// ────────────────────────────────────────────────
function drawOuterFrame(fx, fy, fw, fh) {
  // 내측 비네트 (4개 방향 그라디언트)
  let vDepth = 80; // 비네트 깊이

  // 상단
  for (let i = 0; i < vDepth; i++) {
    let a = map(i, 0, vDepth, 90, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx, fy + i, fw, 1);
  }
  // 하단
  for (let i = 0; i < vDepth; i++) {
    let a = map(i, 0, vDepth, 90, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx, fy + fh - 1 - i, fw, 1);
  }
  // 좌측
  for (let i = 0; i < vDepth * 0.6; i++) {
    let a = map(i, 0, vDepth * 0.6, 60, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx + i, fy, 1, fh);
  }
  // 우측
  for (let i = 0; i < vDepth * 0.6; i++) {
    let a = map(i, 0, vDepth * 0.6, 60, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx + fw - 1 - i, fy, 1, fh);
  }

  // 프레임 테두리 (바깥쪽 밝은 선 + 안쪽 어두운 선)
  noFill();
  strokeWeight(1);
  stroke(255, 255, 255, 18);
  rect(fx - 1, fy - 1, fw + 2, fh + 2, FRAME_R + 1);

  strokeWeight(1.5);
  stroke(255, 255, 255, 40);
  rect(fx, fy, fw, fh, FRAME_R);

  strokeWeight(1);
  stroke(0, 0, 0, 80);
  rect(fx + 1, fy + 1, fw - 2, fh - 2, FRAME_R - 1);

  noStroke();
}

// ────────────────────────────────────────────────
// 상단 바 — 거울 상단에 얇게
// ────────────────────────────────────────────────
function drawTopBar() {
  let fx = FRAME_PAD, fy = FRAME_PAD, fw = width - FRAME_PAD * 2;

  // 상단 그라디언트 페이드 (프레임 내부 — 비네트에서 이미 처리하므로 얇게만)
  for (let i = 0; i < 44; i++) {
    let a = map(i, 0, 44, 100, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx, fy + i, fw, 1);
  }

  let barY = fy + 22;

  // 좌: 모델 상태
  fill(255, 255, 255, 150);
  textAlign(LEFT, CENTER);
  textSize(12);
  text(activeModelName, fx + 18, barY);

  // 중앙: 진행 카운트
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(15);
  text(`${itemCount} / 6`, fx + fw / 2, barY);

  // 우: 선택된 요일
  if (selectedDay !== "") {
    let dayLabel = { Mon:"월요일", Tue:"화요일", Wed:"수요일", Thu:"목요일", Fri:"금요일" }[selectedDay];
    fill(255, 210, 60);
    textAlign(RIGHT, CENTER);
    textSize(13);
    text(dayLabel, fx + fw - 18, barY);
  }
}

// ────────────────────────────────────────────────
// 우측 장비 슬롯 스트립 — 세로 화면에 맞게
// ────────────────────────────────────────────────
function drawGearStrip() {
  let fx = FRAME_PAD, fy = FRAME_PAD, fw = width - FRAME_PAD * 2, fh = height - FRAME_PAD * 2;
  let slotSize = 56;
  let padding  = 10;
  let totalH   = GEAR_ICONS.length * (slotSize + padding) - padding;
  let startX   = fx + fw - slotSize - 16;
  let startY   = fy + (fh - totalH) / 2;

  for (let i = 0; i < GEAR_ICONS.length; i++) {
    let x = startX;
    let y = startY + i * (slotSize + padding);
    let acquired = itemCount > i;

    // 슬롯 배경
    noStroke();
    if (acquired) {
      // 획득 — 골드 + 미세한 테두리
      fill(255, 210, 60, 230);
      rect(x, y, slotSize, slotSize, 10);
      stroke(255, 230, 100, 180);
      strokeWeight(1.5);
      noFill();
      rect(x, y, slotSize, slotSize, 10);
      noStroke();
    } else {
      fill(0, 0, 0, 100);
      rect(x, y, slotSize, slotSize, 10);
      stroke(255, 255, 255, 25);
      strokeWeight(1);
      noFill();
      rect(x, y, slotSize, slotSize, 10);
      noStroke();
    }

    // 아이콘
    textAlign(CENTER, CENTER);
    textSize(24);
    fill(acquired ? color(30, 30, 30) : color(255, 255, 255, 55));
    text(GEAR_ICONS[i], x + slotSize / 2, y + slotSize / 2 - 6);

    // 라벨
    textSize(9);
    fill(acquired ? color(40, 40, 40) : color(255, 255, 255, 45));
    text(GEAR_LABELS[i], x + slotSize / 2, y + slotSize / 2 + 15);
  }
}

// ────────────────────────────────────────────────
// 하단 인식 피드백 패널
// ────────────────────────────────────────────────
function drawScanFeedback() {
  if (itemCount >= 6) return;

  let cleanLabel = currentLabel.replace(/\s+/g, '').toLowerCase();
  let isNone = cleanLabel.includes('none') || cleanLabel === '' || !isAppReady;

  let validTargets = itemCount < 2 ? commonItems : dailyItems;
  let remaining = validTargets.filter(item => !foundItems.includes(item));

  // 현재 인식 중인 남은 아이템 (강조용)
  let matchingItem = remaining.find(t =>
    cleanLabel.includes(t.replace(/\s+/g, '').toLowerCase())
  );
  let isMatch = !!matchingItem && currentConfidence >= 0.8;

  // ── 준비물 칩 영역 ──────────────────────────────
  // 패널 높이는 칩 행 + 게이지 바 + 인식 텍스트
  let chipH   = 28;
  let panelW  = min(width - FRAME_PAD * 2 - 24, 560);
  let panelH  = chipH + 48;
  let px      = FRAME_PAD + (width - FRAME_PAD * 2 - panelW) / 2;
  let py      = height - FRAME_PAD - panelH - 84; // 하단 요일 바(72px) 위에 위치

  noStroke();
  fill(0, 0, 0, 160);
  rect(px, py, panelW, panelH, 10);

  // 요일 미선택 안내
  if (itemCount >= 2 && dailyItems.length === 0) {
    textAlign(CENTER, CENTER);
    textSize(13);
    fill(255, 200, 60);
    text("아래 버튼으로 요일을 선택하세요", px + panelW / 2, py + panelH / 2);
    return;
  }

  // 준비물 칩 그리기 (순서 무관 — 전체 나열)
  let chipPad  = 10;
  let chipR    = 6;
  // 칩 너비를 아이템 수에 따라 동적 계산
  let chipW    = (panelW - chipPad * (remaining.length + 1)) / max(remaining.length, 1);
  chipW        = constrain(chipW, 50, 120);

  // 칩들을 중앙 정렬
  let totalChipW = remaining.length * chipW + (remaining.length - 1) * chipPad;
  let chipStartX = px + (panelW - totalChipW) / 2;

  textAlign(CENTER, CENTER);
  for (let i = 0; i < remaining.length; i++) {
    let cx = chipStartX + i * (chipW + chipPad);
    let cy = py + 8;
    let isActive = (remaining[i] === matchingItem) && isMatch;
    let isScanning = (remaining[i] === matchingItem) && !isNone && currentConfidence >= 0.8;

    // 칩 배경
    if (isActive) {
      fill(80, 220, 120, 230);   // 인식 매칭 중 → 초록
    } else if (remaining[i] === activeTargetInView && holdTime > 0) {
      fill(80, 220, 120, 120);   // 게이지 차는 중 → 연초록
    } else {
      fill(255, 255, 255, 30);   // 대기 중 → 반투명 흰색
    }
    rect(cx, cy, chipW, chipH, chipR);

    // 칩 텍스트
    textSize(12);
    fill(isActive ? color(20, 20, 20) : color(220, 220, 220));
    text(remaining[i], cx + chipW / 2, cy + chipH / 2);
  }

  // ── 게이지 바 ──────────────────────────────────
  let progress = constrain(holdTime / REQUIRED_TIME, 0, 1);
  let barW  = panelW - 32;
  let barX  = px + 16;
  let barY  = py + chipH + 16;

  fill(40, 40, 40);
  rect(barX, barY, barW, 8, 4);

  if (isMatch) fill(80, 220, 120);
  else         fill(60, 60, 60);
  rect(barX, barY, barW * progress, 8, 4);

  // ── 인식 상태 텍스트 ───────────────────────────
  textAlign(CENTER, TOP);
  textSize(11);
  if (isNone) {
    fill(140, 140, 140);
    text("카메라에 준비물을 보여주세요", px + panelW / 2, barY + 12);
  } else if (isMatch) {
    fill(80, 220, 120);
    text(`${currentLabel}  ${Math.floor(currentConfidence * 100)}%`, px + panelW / 2, barY + 12);
  } else {
    fill(200, 120, 120);
    text(`${currentLabel}  ${Math.floor(currentConfidence * 100)}%`, px + panelW / 2, barY + 12);
  }
}

// ────────────────────────────────────────────────
// 중앙 획득 팝업 (플래시 + 텍스트)
// ────────────────────────────────────────────────
function drawAcquirePopup() {
  if (flashTextAlpha <= 0) return;

  push();
  textAlign(CENTER, CENTER);

  // 획득 텍스트
  textSize(32);
  fill(255, 210, 60, flashTextAlpha);
  text(`✔ ${flashItemName} 장착!`, width / 2, height / 2);

  textSize(16);
  fill(255, 255, 255, flashTextAlpha * 0.7);
  text(`${itemCount} / 6 장비 준비 완료`, width / 2, height / 2 + 42);

  flashTextAlpha = max(0, flashTextAlpha - 3);
  pop();
}

// ────────────────────────────────────────────────
// 로직 함수들 (기존과 동일, 획득 시 연출 추가)
// ────────────────────────────────────────────────
function gotPoses(results) {
  poses = results;
}

function classifyVideo() {
  if (isClassifying) return;

  if (itemCount < 2) {
    isClassifying = true;
    activeModelName = "Common Model";
    commonClassifier.classify(video, gotResult);
  } else if (itemCount >= 2 && isDailyLoaded) {
    isClassifying = true;
    activeModelName = `Daily  ·  ${selectedDay}`;
    dailyClassifier.classify(video, gotResult);
  } else if (itemCount >= 2 && !isDailyLoaded) {
    currentLabel = "요일 모델 대기 중";
    setTimeout(classifyVideo, 500);
  }
}

function gotResult(results) {
  isClassifying = false;
  currentLabel = results[0].label;
  currentConfidence = results[0].confidence;
  classifyVideo();
}

function checkLevelUp() {
  if (!isAppReady) {
    holdTime = 0;
    activeTargetInView = "";
    return;
  }

  let validTargets;
  if (itemCount < 2) {
    validTargets = commonItems;
  } else {
    if (dailyItems.length === 0) {
      holdTime = 0;
      activeTargetInView = "";
      return;
    }
    validTargets = dailyItems;
  }

  let isTargetMatch = false;
  let cleanCurrentLabel = currentLabel.replace(/\s+/g, '').toLowerCase();

  for (let target of validTargets) {
    let cleanTarget = target.replace(/\s+/g, '').toLowerCase();
    if (cleanCurrentLabel.includes(cleanTarget) && !foundItems.includes(target)) {
      isTargetMatch = true;
      activeTargetInView = target;
      break;
    }
  }

  if (isTargetMatch && currentConfidence >= 0.8) {
    holdTime += deltaTime;
  } else {
    holdTime -= deltaTime * 1.5;
    if (holdTime < 0) {
      holdTime = 0;
      activeTargetInView = "";
    }
  }

  if (holdTime >= REQUIRED_TIME) {
    foundItems.push(activeTargetInView);
    itemCount++;

    // ── 획득 연출 트리거 ──
    flashAlpha    = 120;
    flashItemName = activeTargetInView;
    flashTextAlpha = 255;

    holdTime = 0;
    activeTargetInView = "";

    if (itemCount === 2 && isDailyLoaded && !isClassifying) {
      classifyVideo();
    }
  }
}

function initDayButtons() {
  // HTML의 .day-btn 버튼들과 연동
  let days   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  let labels = ['월요일', '화요일', '수요일', '목요일', '금요일'];
  let btns   = document.querySelectorAll('.day-btn');

  btns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      // active 스타일 토글
      if (itemCount >= 6) return; 
      if (foundItems.length > 2) return;
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      selectedDay   = days[i];
      dailyItems    = dailyItemsMap[days[i]];
      isDailyLoaded = false;
      isClassifying = false;
      currentLabel  = `${labels[i]} 로딩 중…`;

      dailyClassifier = ml5.imageClassifier(
        `http://127.0.0.1:5500/Models/${days[i]}/model.json`,
        () => {
          isDailyLoaded = true;
          currentLabel  = `${labels[i]} 준비 완료`;
          if (itemCount >= 2 && !isClassifying) classifyVideo();
        }
      );
    });
  });
}

// ────────────────────────────────────────────────
// 장비 렌더링 (기존과 동일)
// ────────────────────────────────────────────────
function getPoint(pose, partName) {
  if (!pose || !pose.keypoints) return null;
  let kp = pose.keypoints.find(k => k.name === partName);
  if (kp?.confidence > 0.05) return kp;
  return null;
}

function drawEquipment(pose) {
  push();
  imageMode(CENTER);

  let nose      = getPoint(pose, 'nose');
  let lEar      = getPoint(pose, 'left_ear');
  let rEar      = getPoint(pose, 'right_ear');
  let lShoulder = getPoint(pose, 'left_shoulder');
  let rShoulder = getPoint(pose, 'right_shoulder');
  let lElbow    = getPoint(pose, 'left_elbow');
  let rElbow    = getPoint(pose, 'right_elbow');
  let lWrist    = getPoint(pose, 'left_wrist');
  let rWrist    = getPoint(pose, 'right_wrist');

  // 몸통
  if (itemCount >= 1 && lShoulder && rShoulder) {
    let shoulderW = dist(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y);
    let cx = (lShoulder.x + rShoulder.x) / 2;
    let cy = (lShoulder.y + rShoulder.y) / 2 + shoulderW * 0.7;
    let w  = shoulderW * 1.8;
    let a  = atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x);
    push(); translate(cx, cy); rotate(a);
    image(imgBody, 0, 0, w, w); pop();
  }

  // 견갑
  if (itemCount >= 2 && lShoulder && rShoulder) {
    let shoulderW = dist(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y);
    let cx = (lShoulder.x + rShoulder.x) / 2;
    let cy = (lShoulder.y + rShoulder.y) / 2 + shoulderW * 0.1;
    let w  = shoulderW * 1.65;
    let a  = atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x);
    push(); translate(cx, cy); rotate(a);
    image(imgShoulder, 0, 0, w, w * 0.6); pop();
  }

  // 헬멧
  if (itemCount >= 5 && nose && lEar && rEar) {
    let headW = dist(lEar.x, lEar.y, rEar.x, rEar.y);
    let hs = headW * 2.0;
    let a  = atan2(rEar.y - lEar.y, rEar.x - lEar.x);
    push(); translate(nose.x, nose.y - headW * 0.6); rotate(a);
    image(imgHelmet, 0, 0, hs, hs * 1.2); pop();
  }

  // 검 — 손목 기준, 팔 방향으로 뻗음
if (itemCount >= 6 && rElbow && rWrist) {
  let armLen = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y);
  let a  = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
  let sw = armLen * 3.0;
  push(); translate(rWrist.x, rWrist.y); rotate(a);
  image(imgSword, sw * 0.5, 0, sw, sw * 0.3); pop();  // 오프셋, 크기 조정
}

// 왼 장갑 — 손목 중심, 손가락이 위를 향하게
if (itemCount >= 3 && lWrist && lElbow) {
  let armLen = dist(lElbow.x, lElbow.y, lWrist.x, lWrist.y);
  let a = atan2(lWrist.y - lElbow.y, lWrist.x - lElbow.x);
  let h = armLen * 1.6;
  push(); translate(lWrist.x, lWrist.y); rotate(a - PI / 2); scale(-1, 1);
  image(imgGlove, 0, 0, h * 0.7, h * 0.9); pop();  // y오프셋 제거
}

// 오른 장갑
if (itemCount >= 4 && rWrist && rElbow) {
  let armLen = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y);
  let a = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
  let h = armLen * 1.6;
  push(); translate(rWrist.x, rWrist.y); rotate(a - PI / 2);
  image(imgGlove, 0, 0, h * 0.7, h * 0.9); pop();  // y오프셋 제거
}

  pop();
}

function keyPressed() {
  if (key >= '0' && key <= '6') itemCount = parseInt(key);
}

function mapPoseToFrame(pose) {
  let fx = FRAME_PAD, fy = FRAME_PAD;
  let fw = width  - FRAME_PAD * 2;
  let fh = height - FRAME_PAD * 2;

  let srcW = video.elt.videoWidth  || width;
  let srcH = video.elt.videoHeight || height;

  let scaleX = fw / srcW;
  let scaleY = fh / srcH;

  let mapped = { keypoints: [] };
  for (let kp of pose.keypoints) {
    let mx = fx + kp.x * scaleX;
    let my = fy + kp.y * scaleY;

    if (smoothedKeypoints[kp.name]) {
      if(kp.confidence > 0.05)
      {
        mx = lerp(smoothedKeypoints[kp.name].x, mx, 0.1);
        my = lerp(smoothedKeypoints[kp.name].y, my, 0.1);
      }
      else
      {
        mx = smoothedKeypoints[kp.name].x;
        my = smoothedKeypoints[kp.name].y;
      }
      
    }
    
    smoothedKeypoints[kp.name] = { x: mx, y: my };

    mapped.keypoints.push({
      name:       kp.name,
      confidence: kp.confidence,
      x: mx,
      y: my,
    });
  }
  return mapped;
}