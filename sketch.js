let video;
let bodyPose;
let poses = [];
let smoothedKeypoints = {};

let commonClassifier;
let dailyClassifier;

let currentLabel = "";

let imgBody, imgShoulder, imgGlove, imgHelmet, imgSword;

let itemCount = 0;
let isDailyLoaded = false;
let isAppReady = false;

let commonItems = ["Wallet", "Phone"];

const dailyItemsMap = {
  Mon: ["SketchBook", "PencilCase", "pencilSharpener", "Fan"],
  Tue: ["TextBook", "IPad", "Perfume", "Bottle"],
  Wed: ["Future", "Creative", "English", "Japanese"],
  Thu: ["Fan", "Reading", "Listening", "Pillcase"],
  Fri: ["illustration", "N2", "Word", "SpringNote"],
};

// ── 요일 전환 제어 변수 ──────────────────────────
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const LABELS = ['월요일', '화요일', '수요일', '목요일', '금요일'];
let currentDayIndex = 0; // 0: Mon ~ 4: Fri
let dailyItems = [];
let selectedDay = "";

let foundItems = [];
let activeTargetInView = "";

let currentConfidence = 0;
let holdTime = 0;
const REQUIRED_TIME = 1000;

let isClassifying = false;

// ── UI 연출용 변수 ──────────────────────────────
let flashAlpha = 0;
let flashItemName = "";
let flashTextAlpha = 0;

// ── 프레임 레이아웃 상수 ─────────────────────────
const FRAME_PAD = 20;
const FRAME_R   = 24;

const ARMOR_ENTRY_SIDES = [
  "bottom",  // 0: 몸통
  "top",     // 1: 견갑
  "left",    // 2: 왼장갑 (왼쪽)
  "right",   // 3: 오른장갑 (오른쪽)
  "top",     // 4: 투구/헬멧 (위에서)
  "right",   // 5: 검 (오른쪽에서)
];

let armorAnimators = [null, null, null, null, null, null];
let impactParticles = [];
let impactRings = [];

// ── 파티클 클래스 ─────────────────────────────
class ImpactParticle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = random(-6, 6);
    this.vy = random(-8, -2);
    this.alpha = 255;
    this.size = random(3, 8);
    this.col = color;
    this.gravity = 0.3;
    this.life = 1.0;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
    this.life -= 0.04;
    this.alpha = this.life * 255;
  }
  draw() {
    push();
    noStroke();
    fill(red(this.col), green(this.col), blue(this.col), this.alpha);
    ellipse(this.x, this.y, this.size * this.life, this.size * this.life);
    pop();
  }
  isDead() { return this.life <= 0; }
}

// ── 충격파  링 클래스 ─────────────────────────
class ImpactRing {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = 10;
    this.maxR = 80;
    this.alpha = 255;
    this.life = 1.0;
  }
  update() {
    this.r = lerp(this.r, this.maxR, 0.12);
    this.life -= 0.04;
    this.alpha = this.life * 200;
  }
  draw() {
    push();
    noFill();
    strokeWeight(2);
    stroke(255, 200, 80, this.alpha);
    ellipse(this.x, this.y, this.r * 2, this.r * 2);
    if (this.life < 0.7) {
      let r2 = this.r * 0.6;
      stroke(255, 255, 255, this.alpha * 0.5);
      strokeWeight(1);
      ellipse(this.x, this.y, r2 * 2, r2 * 2);
    }
    pop();
  }
  isDead() { return this.life <= 0; }
}

// ── 아머 애니메이터 클래스 ───────────────────────
class ArmorAnimator {
  constructor(slotIndex, targetGetter) {
    this.slotIndex = slotIndex;
    this.targetGetter = targetGetter;
    this.phase = "flyIn";
    this.progress = 0;
    this.attachProgress = 0;

    let side = ARMOR_ENTRY_SIDES[slotIndex];
    let margin = 150;
    if (side === "top") {
      this.startX = random(width * 0.2, width * 0.8);
      this.startY = -margin;
    } else if (side === "bottom") {
      this.startX = random(width * 0.2, width * 0.8);
      this.startY = height + margin;
    } else if (side === "left") {
      this.startX = -margin;
      this.startY = random(height * 0.2, height * 0.8);
    } else {
      this.startX = width + margin;
      this.startY = random(height * 0.2, height * 0.8);
    }

    this.currentX = this.startX;
    this.currentY = this.startY;
    this.currentAngle = random(-PI, PI);
    this.trail = [];
    this.maxTrail = 18;
    this.impactSpawned = false;
    this.speed = 0.42;
  }

  getTarget() { return this.targetGetter(); }

  update() {
    let target = this.getTarget();
    if (!target) return;

    if (this.phase === "flyIn") {
      this.trail.push({ x: this.currentX, y: this.currentY });
      if (this.trail.length > this.maxTrail) this.trail.shift();

      this.progress += this.speed;
      let t = this.easeOutBack(min(this.progress, 1.0));

      this.currentX = lerp(this.startX, target.x, t);
      this.currentY = lerp(this.startY, target.y, t);
      this.currentAngle = lerp(this.currentAngle, target.angle, 0.08);

      if (this.progress >= 1.0) {
        this.phase = "attach";
        this.currentX = target.x;
        this.currentY = target.y;
        if (!this.impactSpawned) {
          this.spawnImpact(target.x, target.y);
          this.impactSpawned = true;
        }
      }
    } else if (this.phase === "attach") {
      this.attachProgress += 0.08;
      if (this.attachProgress >= 1.0) this.phase = "done";
    }
  }

  easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2);
  }

  spawnImpact(x, y) {
    impactRings.push(new ImpactRing(x, y));
    impactRings.push(new ImpactRing(x, y));
    let col = color(255, 200, 80);
    for (let i = 0; i < 18; i++) impactParticles.push(new ImpactParticle(x, y, col));
    let white = color(255, 255, 220);
    for (let i = 0; i < 8; i++) impactParticles.push(new ImpactParticle(x, y, white));
  }

  draw(img, target) {
    if (!target || !img) return;
    push();
    imageMode(CENTER);

    if (this.phase === "flyIn") {
      for (let i = 0; i < this.trail.length; i++) {
        let alpha = map(i, 0, this.trail.length, 0, 120);
        let sz    = map(i, 0, this.trail.length, 0.3, 0.9);
        let t = this.trail[i];
        push();
        tint(255, alpha);
        translate(t.x, t.y);
        rotate(this.currentAngle);
        image(img, 0, 0, target.w * sz, target.h * sz);
        pop();
      }

      let blurCount = 3;
      for (let b = blurCount; b >= 1; b--) {
        let bx = lerp(this.currentX, this.startX, b * 0.06);
        let by = lerp(this.currentY, this.startY, b * 0.06);
        push();
        tint(255, 80 / b);
        translate(bx, by);
        rotate(this.currentAngle);
        image(img, 0, 0, target.w, target.h);
        pop();
      }

      push();
      tint(255, 230);
      translate(this.currentX, this.currentY);
      rotate(this.currentAngle);
      let vibScale = 1.0 + sin(frameCount * 0.4) * 0.02;
      scale(vibScale);
      image(img, 0, 0, target.w, target.h);
      pop();

      if (this.progress < 0.85) {
        push();
        stroke(255, 200, 80, 60);
        strokeWeight(1);
        noFill();
        setLineDash([6, 8]);
        line(this.currentX, this.currentY, target.x, target.y);
        setLineDash([]);
        let ch = 12;
        stroke(255, 200, 80, 100);
        line(target.x - ch, target.y, target.x + ch, target.y);
        line(target.x, target.y - ch, target.x, target.y + ch);
        pop();
      }
    } else if (this.phase === "attach") {
      let t = this.attachProgress;
      let pulseSc = 1.0 + (1.0 - t) * 0.25;
      push();
      translate(target.x, target.y);
      rotate(target.angle);
      scale(pulseSc);
      image(img, 0, 0, target.w, target.h);
      pop();

      if (t < 0.5) {
        push();
        tint(255, 200, 80, (1 - t * 2) * 180);
        translate(target.x, target.y);
        rotate(target.angle);
        image(img, 0, 0, target.w * 1.15, target.h * 1.15);
        pop();
      }
    } else {
      push();
      translate(target.x, target.y);
      rotate(target.angle);
      image(img, 0, 0, target.w, target.h);
      pop();
    }
    noTint();
    pop();
  }
}

function setLineDash(list) {
  drawingContext.setLineDash(list);
}

// ── 이미지 & 모델 사전 로드 ─────────────────────────────
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
  let cnv = createCanvas(windowWidth, windowHeight);
  cnv.parent('canvas-wrap');

  video = createCapture(VIDEO, { flipped: true });
  video.hide();

  bodyPose.detectStart(video, gotPoses);
  imageMode(CENTER);

  // 오늘 요일 자동 인식 로직 실행
  initAutoDay();

  setTimeout(() => {
    isAppReady = true;
    classifyVideo();
  }, 2000);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  background(18, 18, 22);

  let fx = FRAME_PAD;
  let fy = FRAME_PAD;
  let fw = width  - FRAME_PAD * 2;
  let fh = height - FRAME_PAD * 2;

  push();
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.roundRect(fx, fy, fw, fh, FRAME_R);
  drawingContext.clip();

  imageMode(CORNER);
  image(video, fx, fy, fw, fh);

  if (poses.length > 0) {
    let pose = poses[0];
    drawEquipment(mapPoseToFrame(pose));
  }

  updateAndDrawEffects();

  if (flashAlpha > 0) {
    noStroke();
    fill(255, 220, 80, flashAlpha);
    rect(fx, fy, fw, fh);
    flashAlpha = max(0, flashAlpha - 8);
  }

  drawingContext.restore();
  pop();

  drawOuterFrame(fx, fy, fw, fh);
  checkLevelUp();
  drawTopBar();
  drawScanFeedback();
  drawAcquirePopup();
}

function updateAndDrawEffects() {
  for (let i = impactRings.length - 1; i >= 0; i--) {
    impactRings[i].update();
    impactRings[i].draw();
    if (impactRings[i].isDead()) impactRings.splice(i, 1);
  }
  for (let i = impactParticles.length - 1; i >= 0; i--) {
    impactParticles[i].update();
    impactParticles[i].draw();
    if (impactParticles[i].isDead()) impactParticles.splice(i, 1);
  }
}

// ── 신체 관절 타겟팅 로직 ─────────────────────────────
function getBodyTarget(pose) {
  let lShoulder = getPoint(pose, 'left_shoulder');
  let rShoulder = getPoint(pose, 'right_shoulder');
  if (!lShoulder || !rShoulder) return null;
  let shoulderW = dist(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y);
  return {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2 + shoulderW * 0.7,
    w: shoulderW * 1.8,
    h: shoulderW * 1.8,
    angle: atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x),
  };
}

function getShoulderTarget(pose) {
  let lShoulder = getPoint(pose, 'left_shoulder');
  let rShoulder = getPoint(pose, 'right_shoulder');
  if (!lShoulder || !rShoulder) return null;
  let shoulderW = dist(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y);
  return {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2 + shoulderW * 0.1,
    w: shoulderW * 1.65,
    h: shoulderW * 1.65 * 0.6,
    angle: atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x),
  };
}

function getLeftGloveTarget(pose) {
  let lWrist = getPoint(pose, 'left_wrist');
  let lElbow = getPoint(pose, 'left_elbow');
  if (!lWrist || !lElbow) return null;
  let armLen = dist(lElbow.x, lElbow.y, lWrist.x, lWrist.y);
  let a = atan2(lWrist.y - lElbow.y, lWrist.x - lElbow.x);
  return {
    x: lWrist.x, y: lWrist.y,
    w: armLen * 1.6 * 0.7,
    h: armLen * 1.6 * 0.9,
    angle: a - PI / 2,
    scaleX: -1,
  };
}

function getRightGloveTarget(pose) {
  let rWrist = getPoint(pose, 'right_wrist');
  let rElbow = getPoint(pose, 'right_elbow');
  if (!rWrist || !rElbow) return null;
  let armLen = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y);
  let a = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
  return {
    x: rWrist.x, y: rWrist.y,
    w: armLen * 1.6 * 0.7,
    h: armLen * 1.6 * 0.9,
    angle: a - PI / 2,
    scaleX: 1,
  };
}

function getHelmetTarget(pose) {
  let nose  = getPoint(pose, 'nose');
  let lEar  = getPoint(pose, 'left_ear');
  let rEar  = getPoint(pose, 'right_ear');
  if (!nose || !lEar || !rEar) return null;
  let headW = dist(lEar.x, lEar.y, rEar.x, rEar.y);
  let hs    = headW * 2.0;
  return {
    x: nose.x,
    y: nose.y - headW * 0.6,
    w: hs,
    h: hs * 1.2,
    angle: atan2(rEar.y - lEar.y, rEar.x - lEar.x),
  };
}

function getSwordTarget(pose) {
  let rElbow = getPoint(pose, 'right_elbow');
  let rWrist = getPoint(pose, 'right_wrist');
  if (!rElbow || !rWrist) return null;
  let armLen = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y);
  let a = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
  let sw = armLen * 3.0;
  return {
    x: rWrist.x + cos(a) * sw * 0.5,
    y: rWrist.y + sin(a) * sw * 0.5,
    w: sw,
    h: sw * 0.3,
    angle: a,
  };
}

function drawOuterFrame(fx, fy, fw, fh) {
  let vDepth = 80;
  for (let i = 0; i < vDepth; i++) {
    let a = map(i, 0, vDepth, 90, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx, fy + i, fw, 1);
  }
  for (let i = 0; i < vDepth; i++) {
    let a = map(i, 0, vDepth, 90, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx, fy + fh - 1 - i, fw, 1);
  }
  for (let i = 0; i < vDepth * 0.6; i++) {
    let a = map(i, 0, vDepth * 0.6, 60, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx + i, fy, 1, fh);
  }
  for (let i = 0; i < vDepth * 0.6; i++) {
    let a = map(i, 0, vDepth * 0.6, 60, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx + fw - 1 - i, fy, 1, fh);
  }
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

// ── 🛠️ 1. 상단 바 인터페이스 (스마트 거울 스타일 날짜/시간 반영) ─────────────────────────────
function drawTopBar() {
  let fx = FRAME_PAD, fy = FRAME_PAD, fw = width - FRAME_PAD * 2;
  
  // 두 줄 정보 출력을 위해 상단 그라데이션 영역을 44에서 56으로 늘려 가독성을 극대화합니다.
  for (let i = 0; i < 56; i++) {
    let a = map(i, 0, 56, 120, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx, fy + i, fw, 1);
  }
  
  let barY = fy + 26; // 수직 중앙 정렬선 조절

  // 🕒 p5.js 내장 함수 기반의 실시간 날짜 및 시간 포맷팅
  let dateStr = `${year()}. ${nf(month(), 2)}. ${nf(day(), 2)}.`;
  let timeStr = `${nf(hour(), 2)}:${nf(minute(), 2)}:${nf(second(), 2)}`;

  push();
  textAlign(LEFT, TOP);
  
  // 첫 번째 줄: 날짜 표시 (은은하고 얇은 서브 텍스트 연출)
  textSize(11);
  fill(255, 255, 255, 130);
  text(dateStr, fx + 18, fy + 12);
  
  // 두 번째 줄: 시간 표시 (크고 선명한 메인 텍스트 연출)
  textSize(15);
  fill(255, 255, 255, 220);
  text(timeStr, fx + 18, fy + 27);
  pop();

  // 중앙 영역: 레벨 카운트 정보
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(15);
  text(`${itemCount} / 6`, fx + fw / 2, barY);
  
  // 우측 영역: 활성화된 수요일/목요일 등 한국어 요일 노출
  if (selectedDay !== "") {
    fill(255, 210, 60);
    textAlign(RIGHT, CENTER);
    textSize(13);
    text(LABELS[currentDayIndex], fx + fw - 18, barY);
  }
}

function drawScanFeedback() {
  if (itemCount >= 6) return;

  let cleanLabel = currentLabel.replace(/\s+/g, '').toLowerCase();
  let isNone = cleanLabel.includes('none') || cleanLabel === '' || !isAppReady;

  let validTargets = itemCount < 2 ? commonItems : dailyItems;
  let remaining = validTargets.filter(item => !foundItems.includes(item));

  let matchingItem = remaining.find(t =>
    cleanLabel.includes(t.replace(/\s+/g, '').toLowerCase())
  );
  let isMatch = !!matchingItem && currentConfidence >= 0.8;

  let chipH   = 28;
  let panelW  = min(width - FRAME_PAD * 2 - 24, 560);
  let panelH  = chipH + 48;
  let px      = FRAME_PAD + (width - FRAME_PAD * 2 - panelW) / 2;
  let py      = height - FRAME_PAD - panelH - 84;

  noStroke();
  fill(0, 0, 0, 160);
  rect(px, py, panelW, panelH, 10);

  let chipPad  = 10;
  let chipR    = 6;
  let chipW    = (panelW - chipPad * (remaining.length + 1)) / max(remaining.length, 1);
  chipW        = constrain(chipW, 50, 120);
  let totalChipW = remaining.length * chipW + (remaining.length - 1) * chipPad;
  let chipStartX = px + (panelW - totalChipW) / 2;

  textAlign(CENTER, CENTER);
  for (let i = 0; i < remaining.length; i++) {
    let cx = chipStartX + i * (chipW + chipPad);
    let cy = py + 8;
    let isActive = (remaining[i] === matchingItem) && isMatch;

    if (isActive) {
      fill(80, 220, 120, 230);
    } else if (remaining[i] === activeTargetInView && holdTime > 0) {
      fill(80, 220, 120, 120);
    } else {
      fill(255, 255, 255, 30);
    }
    rect(cx, cy, chipW, chipH, chipR);
    textSize(12);
    fill(isActive ? color(20, 20, 20) : color(220, 220, 220));
    text(remaining[i], cx + chipW / 2, cy + chipH / 2);
  }

  let progress = constrain(holdTime / REQUIRED_TIME, 0, 1);
  let barW  = panelW - 32;
  let barX  = px + 16;
  let barY  = py + chipH + 16;

  fill(40, 40, 40);
  rect(barX, barY, barW, 8, 4);
  if (isMatch) fill(80, 220, 120);
  else         fill(60, 60, 60);
  rect(barX, barY, barW * progress, 8, 4);

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

function drawAcquirePopup() {
  if (flashTextAlpha <= 0) return;
  push();
  textAlign(CENTER, CENTER);
  textSize(32);
  fill(255, 210, 60, flashTextAlpha);
  text(`✔ ${flashItemName} 장착!`, width / 2, height / 2);
  textSize(16);
  fill(255, 255, 255, flashTextAlpha * 0.7);
  text(`${itemCount} / 6 장비 준비 완료`, width / 2, height / 2 + 42);
  flashTextAlpha = max(0, flashTextAlpha - 3);
  pop();
}

function gotPoses(results) {
  poses = results;
}

function classifyVideo() {
  if (isClassifying) return;
  if (itemCount < 2) {
    isClassifying = true;
    commonClassifier.classify(video, gotResult);
  } else if (itemCount >= 2 && isDailyLoaded) {
    isClassifying = true;
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

    let slotIdx = itemCount;
    let currentPose = poses.length > 0 ? mapPoseToFrame(poses[0]) : null;

    let makeGetter = (fn) => {
      return () => {
        let p = poses.length > 0 ? mapPoseToFrame(poses[0]) : null;
        return p ? fn(p) : null;
      };
    };

    let getters = [
      makeGetter(getBodyTarget),
      makeGetter(getShoulderTarget),
      makeGetter(getLeftGloveTarget),
      makeGetter(getRightGloveTarget),
      makeGetter(getHelmetTarget),
      makeGetter(getSwordTarget),
    ];

    if (slotIdx >= 0 && slotIdx < 6) {
      setTimeout(() => {
        itemCount++;
        armorAnimators[slotIdx] = new ArmorAnimator(slotIdx, getters[slotIdx]);
      }, 1500);
    }

    flashAlpha     = 80;
    flashItemName  = activeTargetInView;
    flashTextAlpha = 255;

    holdTime = 0;
    activeTargetInView = "";

    if (itemCount === 2 && isDailyLoaded && !isClassifying) {
      classifyVideo();
    }
  }
}

// ── 🛠️ 2. 오늘 요일 자동 인식 및 주말 예외 처리 ─────────────────────────────
function initAutoDay() {
  let today = new Date().getDay(); // 0(일) ~ 6(토)
  
  if (today === 0) {
    currentDayIndex = 0; // 일요일이면 월요일로 수렴
  } else if (today === 6) {
    currentDayIndex = 4; // 토요일이면 금요일로 수렴
  } else {
    currentDayIndex = today - 1; // 평일(월~금: 1~5)을 인덱스(0~4)로 맵핑
  }
  
  loadDayModel(currentDayIndex);
}

function loadDayModel(index) {
  selectedDay = DAYS[index];
  dailyItems = dailyItemsMap[selectedDay];
  isDailyLoaded = false;
  isClassifying = false;
  currentLabel = `${LABELS[index]} 로딩 중…`;

  dailyClassifier = ml5.imageClassifier(
    `http://127.0.0.1:5500/Models/${selectedDay}/model.json`,
    () => {
      isDailyLoaded = true;
      currentLabel = `${LABELS[index]} 준비 완료`;
      if (itemCount >= 2 && !isClassifying) classifyVideo();
    }
  );
}

// ── 🛠️ 3. 좌/우 방향키를 통한 인터랙티브 요일 스위칭 ─────────────────────────────
function keyPressed() {
  // if (key >= '0' && key <= '6') itemCount = parseInt(key);

  if(foundItems.length > 3)
    return;
  
  if (keyCode === LEFT_ARROW) {
    if (currentDayIndex > 0) {
      currentDayIndex--;
      loadDayModel(currentDayIndex);
    }
  } else if (keyCode === RIGHT_ARROW) {
    if (currentDayIndex < 4) {
      currentDayIndex++;
      loadDayModel(currentDayIndex);
    }
  }
}

function getPoint(pose, partName) {
  if (!pose || !pose.keypoints) return null;
  let kp = pose.keypoints.find(k => k.name === partName);
  if (kp?.confidence > 0.05) return kp;
  return null;
}

function drawEquipment(pose) {
  push();
  imageMode(CENTER);

  const imgs = [imgBody, imgShoulder, imgGlove, imgGlove, imgHelmet, imgSword];
  const renderOrder = [0, 1, 4, 5, 2, 3];

  for (let slotIdx of renderOrder) {
    if (itemCount <= slotIdx) continue; 

    let anim = armorAnimators[slotIdx];
    if (!anim) {
      drawStaticArmor(slotIdx, pose);
      continue;
    }

    anim.update();
    let target = anim.getTarget();
    if (target) {
      if (slotIdx === 2) {
        push();
        scale(-1, 1);
        let flippedTarget = Object.assign({}, target, { x: -target.x });
        anim.draw(imgs[slotIdx], flippedTarget);
        pop();
      } else {
        anim.draw(imgs[slotIdx], target);
      }
    }

    if (anim.phase === "done") {
      armorAnimators[slotIdx] = null;
    }
  }
  pop();
}

function drawStaticArmor(slotIdx, pose) {
  push();
  imageMode(CENTER);

  if (slotIdx === 0) {
    let lShoulder = getPoint(pose, 'left_shoulder');
    let rShoulder = getPoint(pose, 'right_shoulder');
    if (lShoulder && rShoulder) {
      let shoulderW = dist(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y);
      let cx = (lShoulder.x + rShoulder.x) / 2;
      let cy = (lShoulder.y + rShoulder.y) / 2 + shoulderW * 0.7;
      let w  = shoulderW * 1.8;
      let a  = atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x);
      push(); translate(cx, cy); rotate(a);
      image(imgBody, 0, 0, w, w); pop();
    }
  } else if (slotIdx === 1) {
    let lShoulder = getPoint(pose, 'left_shoulder');
    let rShoulder = getPoint(pose, 'right_shoulder');
    if (lShoulder && rShoulder) {
      let shoulderW = dist(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y);
      let cx = (lShoulder.x + rShoulder.x) / 2;
      let cy = (lShoulder.y + rShoulder.y) / 2 + shoulderW * 0.1;
      let w  = shoulderW * 1.65;
      let a  = atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x);
      push(); translate(cx, cy); rotate(a);
      image(imgShoulder, 0, 0, w, w * 0.6); pop();
    }
  } else if (slotIdx === 2) {
    let lWrist = getPoint(pose, 'left_wrist');
    let lElbow = getPoint(pose, 'left_elbow');
    if (lWrist && lElbow) {
      let armLen = dist(lElbow.x, lElbow.y, lWrist.x, lWrist.y);
      let a = atan2(lWrist.y - lElbow.y, lWrist.x - lElbow.x);
      let h = armLen * 1.6;
      push(); translate(lWrist.x, lWrist.y); rotate(a - PI / 2); scale(-1, 1);
      image(imgGlove, 0, 0, h * 0.7, h * 0.9); pop();
    }
  } else if (slotIdx === 3) {
    let rWrist = getPoint(pose, 'right_wrist');
    let rElbow = getPoint(pose, 'right_elbow');
    if (rWrist && rElbow) {
      let armLen = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y);
      let a = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
      let h = armLen * 1.6;
      push(); translate(rWrist.x, rWrist.y); rotate(a - PI / 2);
      image(imgGlove, 0, 0, h * 0.7, h * 0.9); pop();
    }
  } else if (slotIdx === 4) {
    let nose  = getPoint(pose, 'nose');
    let lEar  = getPoint(pose, 'left_ear');
    let rEar  = getPoint(pose, 'right_ear');
    if (nose && lEar && rEar) {
      let headW = dist(lEar.x, lEar.y, rEar.x, rEar.y);
      let hs = headW * 2.0;
      let a  = atan2(rEar.y - lEar.y, rEar.x - lEar.x);
      push(); translate(nose.x, nose.y - headW * 0.6); rotate(a);
      image(imgHelmet, 0, 0, hs, hs * 1.2); pop();
    }
  } else if (slotIdx === 5) {
    let rElbow = getPoint(pose, 'right_elbow');
    let rWrist = getPoint(pose, 'right_wrist');
    if (rElbow && rWrist) {
      let armLen = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y);
      let a  = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
      let sw = armLen * 3.0;
      push(); translate(rWrist.x, rWrist.y); rotate(a);
      image(imgSword, sw * 0.5, 0, sw, sw * 0.3); pop();
    }
  }

  pop();
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
      if (kp.confidence > 0.05) {
        mx = lerp(smoothedKeypoints[kp.name].x, mx, 0.1);
        my = lerp(smoothedKeypoints[kp.name].y, my, 0.1);
      } else {
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