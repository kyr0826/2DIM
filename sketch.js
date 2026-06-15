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
  Mon: ["SketchBook", "PencilCase", "pencilSharpener", "Fan"],
  Tue: ["TextBook", "IPad", "Perfume", "Bottle"],
  Wed: ["Future", "Creative", "English", "Japanese"],
  Thu: ["Fan", "Reading", "Listening", "Pillcase"],
  Fri: ["illustration", "N2", "Word", "SpringNote"],
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
let flashAlpha = 0;
let flashItemName = "";
let flashTextAlpha = 0;

// ── 프레임 레이아웃 상수 ─────────────────────────
const FRAME_PAD = 20;
const FRAME_R   = 24;

// 장비 아이콘 정의
const GEAR_ICONS  = ["🛡", "🦾", "🧤", "🧤", "⛑", "⚔"];
const GEAR_LABELS = ["몸통", "견갑", "왼손", "오른손", "투구", "검"];

const ARMOR_ENTRY_SIDES = [
  "bottom",  // 0: 몸통
  "top",     // 1: 견갑
  "left",    // 2: 왼장갑 (왼쪽)
  "right",   // 3: 오른장갑 (오른쪽)
  "top",     // 4: 투구/헬멧 (위에서)
  "right",   // 5: 검 (오른쪽에서)
];

// ── 아이언맨 마크42 스타일 플라이인 애니메이션 ─────
// 각 장비 슬롯마다 애니메이터 객체 배열
// 슬롯 순서: 0=몸통, 1=견갑, 2=왼장갑, 3=오른장갑, 4=헬멧, 5=검
let armorAnimators = [null, null, null, null, null, null];

// 충격 파티클 시스템
let impactParticles = [];

// 착용 충격파 링 (부착 순간 링 확장 효과)
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

// ── 충격파 링 클래스 ─────────────────────────
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
    // 두 번째 링 (약간 지연)
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

// ── 아머 애니메이터 클래스 (마크42 플라이인) ─────
class ArmorAnimator {
  constructor(slotIndex, targetGetter) {
    this.slotIndex = slotIndex;
    this.targetGetter = targetGetter; // 함수: 현재 목표 위치 {x,y,w,h,angle} 반환
    this.phase = "flyIn";   // "flyIn" → "attach" → "done"
    this.progress = 0;      // 0~1 플라이인 진행
    this.attachProgress = 0; // 부착 충격 진행

    // 진입 방향에 따라 시작 위치 설정
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

    // 트레일(궤적) 저장
    this.trail = [];
    this.maxTrail = 18;

    // 착지 충격 발생했는지
    this.impactSpawned = false;

    // 진입 속도 (easeOutQuart 느낌)
    this.speed = 0.42;
  }

  getTarget() {
    return this.targetGetter();
  }

  update() {
    let target = this.getTarget();
    if (!target) return;

    if (this.phase === "flyIn") {
      // 궤적 저장
      this.trail.push({ x: this.currentX, y: this.currentY });
      if (this.trail.length > this.maxTrail) this.trail.shift();

      this.progress += this.speed;

      // easeOutBack 커브 (살짝 오버슈팅)
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
      if (this.attachProgress >= 1.0) {
        this.phase = "done";
      }
    }
  }

  easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2);
  }

  spawnImpact(x, y) {
    // 충격파 링
    impactRings.push(new ImpactRing(x, y));
    impactRings.push(new ImpactRing(x, y)); // 두 겹

    // 파티클 스파크
    let col = color(255, 200, 80);
    for (let i = 0; i < 18; i++) {
      impactParticles.push(new ImpactParticle(x, y, col));
    }
    // 흰색 스파크도 약간
    let white = color(255, 255, 220);
    for (let i = 0; i < 8; i++) {
      impactParticles.push(new ImpactParticle(x, y, white));
    }
  }

  draw(img, target) {
    if (!target || !img) return;

    push();
    imageMode(CENTER);

    if (this.phase === "flyIn") {
      // ── 궤적(트레일) 그리기 ──
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

      // ── 비행 중인 갑옷 본체 ──
      // 속도감을 위한 모션블러 효과 (여러 겹 반투명)
      let blurCount = 3;
      let bTarget = this.getTarget();
      if (bTarget) {
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
      }

      // 본체
      push();
      tint(255, 230);
      translate(this.currentX, this.currentY);
      rotate(this.currentAngle);
      // 비행 중 미세한 스케일 진동
      let vibScale = 1.0 + sin(frameCount * 0.4) * 0.02;
      scale(vibScale);
      image(img, 0, 0, target.w, target.h);
      pop();

      // ── 비행 경로 표시 점선 (얇게) ──
      if (this.progress < 0.85) {
        push();
        stroke(255, 200, 80, 60);
        strokeWeight(1);
        noFill();
        setLineDash([6, 8]);
        line(this.currentX, this.currentY, target.x, target.y);
        setLineDash([]);
        // 목표 지점 크로스헤어
        let ch = 12;
        stroke(255, 200, 80, 100);
        line(target.x - ch, target.y, target.x + ch, target.y);
        line(target.x, target.y - ch, target.x, target.y + ch);
        pop();
      }

    } else if (this.phase === "attach") {
      // ── 부착 충격 애니메이션 ──
      let t = this.attachProgress;
      let easedT = this.easeOutBack(min(t, 1.0));

      // 부착 순간 스케일 펄스 (살짝 커졌다 돌아옴)
      let pulseSc = 1.0 + (1.0 - t) * 0.25;

      push();
      translate(target.x, target.y);
      rotate(target.angle);
      scale(pulseSc);
      image(img, 0, 0, target.w, target.h);
      pop();

      // 부착 글로우 (밝은 테두리 효과)
      if (t < 0.5) {
        push();
        tint(255, 200, 80, (1 - t * 2) * 180);
        translate(target.x, target.y);
        rotate(target.angle);
        image(img, 0, 0, target.w * 1.15, target.h * 1.15);
        pop();
        noTint();
      }

    } else {
      // ── 완전 부착 상태 — 일반 렌더 ──
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

// p5.js 내장 setLineDash 헬퍼
function setLineDash(list) {
  drawingContext.setLineDash(list);
}

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

  initDayButtons();

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

  // 장비 오버레이 (클립 안에서)
  if (poses.length > 0) {
    let pose = poses[0];
    drawEquipment(mapPoseToFrame(pose));
  }

  // 파티클 & 링 업데이트/드로우 (클립 안에서)
  updateAndDrawEffects();

  // 획득 플래시
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
  drawGearStrip();
  drawScanFeedback();
  drawAcquirePopup();
}

// ────────────────────────────────────────────────
// 파티클 & 링 효과 업데이트
// ────────────────────────────────────────────────
function updateAndDrawEffects() {
  // 충격파 링
  for (let i = impactRings.length - 1; i >= 0; i--) {
    impactRings[i].update();
    impactRings[i].draw();
    if (impactRings[i].isDead()) impactRings.splice(i, 1);
  }
  // 스파크 파티클
  for (let i = impactParticles.length - 1; i >= 0; i--) {
    impactParticles[i].update();
    impactParticles[i].draw();
    if (impactParticles[i].isDead()) impactParticles.splice(i, 1);
  }
}

// ────────────────────────────────────────────────
// 장비 타겟 위치 계산 함수들
// ────────────────────────────────────────────────
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

// ────────────────────────────────────────────────
// 외곽 프레임
// ────────────────────────────────────────────────
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

// ────────────────────────────────────────────────
// 상단 바
// ────────────────────────────────────────────────
function drawTopBar() {
  let fx = FRAME_PAD, fy = FRAME_PAD, fw = width - FRAME_PAD * 2;
  for (let i = 0; i < 44; i++) {
    let a = map(i, 0, 44, 100, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx, fy + i, fw, 1);
  }
  let barY = fy + 22;
  fill(255, 255, 255, 150);
  textAlign(LEFT, CENTER);
  textSize(12);
  text(activeModelName, fx + 18, barY);
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(15);
  text(`${itemCount} / 6`, fx + fw / 2, barY);
  if (selectedDay !== "") {
    let dayLabel = { Mon:"월요일", Tue:"화요일", Wed:"수요일", Thu:"목요일", Fri:"금요일" }[selectedDay];
    fill(255, 210, 60);
    textAlign(RIGHT, CENTER);
    textSize(13);
    text(dayLabel, fx + fw - 18, barY);
  }
}

// ────────────────────────────────────────────────
// 우측 장비 슬롯 스트립
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

    // 비행 중인 장비 슬롯은 pulse 효과
    let isFlying = armorAnimators[i] && armorAnimators[i].phase === "flyIn";

    noStroke();
    if (acquired) {
      fill(255, 210, 60, 230);
      rect(x, y, slotSize, slotSize, 10);
      stroke(255, 230, 100, 180);
      strokeWeight(1.5);
      noFill();
      rect(x, y, slotSize, slotSize, 10);
      noStroke();
    } else if (isFlying) {
      // 비행 중 슬롯 — 깜빡이는 테두리
      let pulse = (sin(frameCount * 0.2) + 1) / 2;
      fill(255, 150, 30, 60 + pulse * 60);
      rect(x, y, slotSize, slotSize, 10);
      stroke(255, 180, 60, 150 + pulse * 100);
      strokeWeight(2);
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

    textAlign(CENTER, CENTER);
    textSize(24);
    fill(acquired ? color(30, 30, 30) : isFlying ? color(255, 180, 60, 200) : color(255, 255, 255, 55));
    text(GEAR_ICONS[i], x + slotSize / 2, y + slotSize / 2 - 6);
    textSize(9);
    fill(acquired ? color(40, 40, 40) : isFlying ? color(255, 200, 100, 180) : color(255, 255, 255, 45));
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

  if (itemCount >= 2 && dailyItems.length === 0) {
    textAlign(CENTER, CENTER);
    textSize(13);
    fill(255, 200, 60);
    text("아래 버튼으로 요일을 선택하세요", px + panelW / 2, py + panelH / 2);
    return;
  }

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

// ────────────────────────────────────────────────
// 중앙 획득 팝업
// ────────────────────────────────────────────────
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

// ────────────────────────────────────────────────
// 포즈 콜백
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

// ────────────────────────────────────────────────
// 레벨업 체크 — 아이템 획득 시 플라이인 애니메이터 생성
// ────────────────────────────────────────────────
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
    

    // ── 마크42 플라이인 애니메이터 생성 ──
    let slotIdx = itemCount; // 방금 획득한 슬롯
    let currentPose = poses.length > 0 ? mapPoseToFrame(poses[0]) : null;

    // 각 슬롯에 맞는 targetGetter 함수등록
    let targetGetters = [
      () => currentPose ? getBodyTarget(currentPose) : null,
      () => currentPose ? getShoulderTarget(currentPose) : null,
      () => currentPose ? getLeftGloveTarget(currentPose) : null,
      () => currentPose ? getRightGloveTarget(currentPose) : null,
      () => currentPose ? getHelmetTarget(currentPose) : null,
      () => currentPose ? getSwordTarget(currentPose) : null,
    ];

    // poses가 계속 업데이트되도록 클로저를 통해 최신 포즈 참조
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

        armorAnimators[slotIdx] =
          new ArmorAnimator(slotIdx, getters[slotIdx]);
      }, 1500);
    }

    // ── 플래시 연출 ──
    flashAlpha     = 80;  // 플라이인이 있으니 플래시 약하게
    flashItemName  = activeTargetInView;
    flashTextAlpha = 255;

    holdTime = 0;
    activeTargetInView = "";

    if (itemCount === 2 && isDailyLoaded && !isClassifying) {
      classifyVideo();
    }
  }
}

// ────────────────────────────────────────────────
// 요일 버튼 초기화
// ────────────────────────────────────────────────
function initDayButtons() {
  let days   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  let labels = ['월요일', '화요일', '수요일', '목요일', '금요일'];
  let btns   = document.querySelectorAll('.day-btn');

  btns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (itemCount >= 6) return;
      if (foundItems.length > 3) return;
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
// 장비 렌더링 — 애니메이터 통합
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

  const imgs = [imgBody, imgShoulder, imgGlove, imgGlove, imgHelmet, imgSword];

  const renderOrder = [0, 1, 4, 5, 2, 3];

  for (let slotIdx of renderOrder) {
    if (itemCount <= slotIdx) continue; // 아직 획득 안 한 장비는 스킵

    let anim = armorAnimators[slotIdx];
    if (!anim) {
      drawStaticArmor(slotIdx, pose);
      continue;
    }

    anim.update();
    let target = anim.getTarget();
    if (target) {
      // 2번 슬롯(왼장갑)일 때만 좌우 반전
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
  } else if (slotIdx === 2) { // 2번: 왼장갑
    let lWrist = getPoint(pose, 'left_wrist');
    let lElbow = getPoint(pose, 'left_elbow');
    if (lWrist && lElbow) {
      let armLen = dist(lElbow.x, lElbow.y, lWrist.x, lWrist.y);
      let a = atan2(lWrist.y - lElbow.y, lWrist.x - lElbow.x);
      let h = armLen * 1.6;
      push(); translate(lWrist.x, lWrist.y); rotate(a - PI / 2); scale(-1, 1);
      image(imgGlove, 0, 0, h * 0.7, h * 0.9); pop();
    }
  } else if (slotIdx === 3) { // 3번: 오른장갑
    let rWrist = getPoint(pose, 'right_wrist');
    let rElbow = getPoint(pose, 'right_elbow');
    if (rWrist && rElbow) {
      let armLen = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y);
      let a = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
      let h = armLen * 1.6;
      push(); translate(rWrist.x, rWrist.y); rotate(a - PI / 2);
      image(imgGlove, 0, 0, h * 0.7, h * 0.9); pop();
    }
  } else if (slotIdx === 4) { // 4번: 헬멧
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
  } else if (slotIdx === 5) { // 5번: 검
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