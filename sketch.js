let video;
let W, H, seed;
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
let currentDayIndex = 0; 
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

const FRAME_PAD = 20;
const FRAME_R   = 24;

const ARMOR_ENTRY_SIDES = [
  "bottom",  // 0: 몸통
  "top",     // 1: 견갑
  "left",    // 2: 왼장갑
  "right",   // 3: 오른장갑
  "top",     // 4: 헬멧
  "right",   // 5: 검
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

  W = width;
  H = height;
  seed = 42;

  video = createCapture(VIDEO, { flipped: true });
  video.hide();

  bodyPose.detectStart(video, gotPoses);
  imageMode(CENTER);

  initAutoDay();

  setTimeout(() => {
    isAppReady = true;
    classifyVideo();
  }, 2000);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  W = width;
  H = height;
}

function draw() {
  randomSeed(seed);  

  

  updateAndDrawEffects();

  drawScene();
  drawAmbientRoom();
  drawMirror();

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



// ── 스마트 거울 상단 바 ─────────────────────────────
function drawTopBar() {
  let fx = FRAME_PAD, fy = FRAME_PAD, fw = width - FRAME_PAD * 2;
  
  for (let i = 0; i < 56; i++) {
    let a = map(i, 0, 56, 120, 0);
    noStroke(); fill(0, 0, 0, a);
    rect(fx, fy + i, fw, 1);
  }
  
  let barY = fy + 26;

  let dateStr = `${year()}. ${nf(month(), 2)}. ${nf(day(), 2)}.`;
  let timeStr = `${nf(hour(), 2)}:${nf(minute(), 2)}:${nf(second(), 2)}`;

  push();
  textAlign(LEFT, TOP);
  textSize(11);
  fill(255, 255, 255, 130);
  text(dateStr, fx + 18, fy + 12);
  
  textSize(15);
  fill(255, 255, 255, 220);
  text(timeStr, fx + 18, fy + 27);
  pop();

  fill(255);
  textAlign(CENTER, CENTER);
  textSize(15);
  text(`${itemCount} / 6`, fx + fw / 2, barY);
  
  if (selectedDay !== "") {
    fill(255, 210, 60);
    textAlign(RIGHT, CENTER);
    textSize(13);
    text(LABELS[currentDayIndex], fx + fw - 18, barY);
  }
}

// ── 하단 스캔 피드백 (0~3: 요일, 4~5: 공통) ──────────────
function drawScanFeedback() {
  if (itemCount >= 6) return;

  let cleanLabel = currentLabel.replace(/\s+/g, '').toLowerCase();
  let isNone = cleanLabel.includes('none') || cleanLabel === '' || !isAppReady;

  // ⭐️ 여기서 itemCount < 4 이면 요일 아이템 리스트 표시
  let validTargets = itemCount < 4 ? dailyItems : commonItems;
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

// ── ⭐️ AI 모델 분류 로직 (0~3: 요일, 4~5: 공통) ──────────
function classifyVideo() {
  if (isClassifying) return;
  
  if (itemCount < 4) {
    if (isDailyLoaded) {
      isClassifying = true;
      dailyClassifier.classify(video, gotResult);
    } else {
      currentLabel = "";
      setTimeout(classifyVideo, 500);
    }
  } else if (itemCount < 6) {
    isClassifying = true;
    commonClassifier.classify(video, gotResult);
  }
}

function gotResult(results) {
  isClassifying = false;
  currentLabel = results[0].label;
  currentConfidence = results[0].confidence;
  classifyVideo(); // 무한 루프
}

function checkLevelUp() {
  if (!isAppReady) {
    holdTime = 0;
    activeTargetInView = "";
    return;
  }

  // ⭐️ 0~3개까지는 요일 물건, 4~5개일 때는 공통 물건을 타겟으로 잡음
  let validTargets = itemCount < 4 ? dailyItems : commonItems;

  if (itemCount < 4 && dailyItems.length === 0) {
    holdTime = 0;
    activeTargetInView = "";
    return;
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
  }
}

// ── 요일 자동 선택 및 방향키 ─────────────────────────────
function initAutoDay() {
  let today = new Date().getDay(); 
  if (today === 0) currentDayIndex = 0; 
  else if (today === 6) currentDayIndex = 4;
  else currentDayIndex = today - 1; 
  
  loadDayModel(currentDayIndex);
}

function loadDayModel(index) {
  selectedDay = DAYS[index];
  dailyItems = dailyItemsMap[selectedDay];
  isDailyLoaded = false;
  isClassifying = false;
  currentLabel = ""; 

  dailyClassifier = ml5.imageClassifier(
    `http://127.0.0.1:5500/Models/${selectedDay}/model.json`,
    () => {
      isDailyLoaded = true;
      if (itemCount < 4 && !isClassifying) classifyVideo();
    }
  );
}

function keyPressed() {
  // if (key >= '0' && key <= '6') itemCount = parseInt(key);

  if(foundItems.length > 0)
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
  let fx = W * 0.2568;
  let fy = H * 0.0735;
  let fw = W * 0.467;
  let fh = H * 1.02;

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




function drawScene() {
  // sc is the universal scale factor — all px values were authored at W=1300
  let sc = W / 1300;

  // ── BACKGROUND WALL ────────────────────────────────────────
  background(172, 152, 128);

  for (let y = 0; y < H; y += 3) {
    let alpha = map(noise(0.001, y * 0.003), 0, 1, 0, 6);
    drawingContext.fillStyle = `rgba(255,255,255,${alpha / 255})`;
    drawingContext.fillRect(0, y, W, 2);
  }

  // Ceiling ambient
  let ceilGrad = drawingContext.createRadialGradient(W * 0.5, 0, 0, W * 0.5, 0, H * 0.7);
  ceilGrad.addColorStop(0,   'rgba(220,210,200,0.28)');
  ceilGrad.addColorStop(0.5, 'rgba(200,185,165,0.10)');
  ceilGrad.addColorStop(1,   'rgba(200,185,165,0)');
  drawingContext.fillStyle = ceilGrad;
  rect(0, 0, W, H);

  // Warm glow left
  let glL = drawingContext.createRadialGradient(W * 0.06, H * 0.88, 0, W * 0.06, H * 0.88, W * 0.38);
  glL.addColorStop(0,   'rgba(255,195,95,0.32)');
  glL.addColorStop(0.4, 'rgba(255,175,70,0.12)');
  glL.addColorStop(1,   'rgba(255,160,50,0)');
  drawingContext.fillStyle = glL;
  rect(0, 0, W, H);

  // Warm glow right (lamp)
  let glR = drawingContext.createRadialGradient(W * 0.84, H * 0.68, 0, W * 0.84, H * 0.68, W * 0.32);
  glR.addColorStop(0,   'rgba(255,210,120,0.45)');
  glR.addColorStop(0.45,'rgba(255,190,85,0.18)');
  glR.addColorStop(1,   'rgba(255,170,60,0)');
  drawingContext.fillStyle = glR;
  rect(0, 0, W, H);

  // Vignette
  let vg = drawingContext.createRadialGradient(W / 2, H * 0.42, H * 0.12, W / 2, H * 0.42, H * 1.0);
  vg.addColorStop(0,   'rgba(0,0,0,0)');
  vg.addColorStop(0.6, 'rgba(0,0,0,0.20)');
  vg.addColorStop(1,   'rgba(0,0,0,0.65)');
  drawingContext.fillStyle = vg;
  rect(0, 0, W, H);

  // Wall grain
  drawingContext.save();
  for (let i = 0; i < 2400; i++) {
    let tx = random(W), ty = random(H);
    let a = random(0, 12);
    drawingContext.fillStyle = `rgba(0,0,0,${a / 255})`;
    drawingContext.fillRect(tx, ty, 1, 1);
  }
  drawingContext.restore();

  // ── TOP-LEFT: TV ──────────────────────────────────────────
  // In photo: TV sits in very top-left, roughly 0–18% width, 0–23% height
  let tvX = W * 0.002, tvY = H * 0.005;
  let tvW = W * 0.155, tvH = H * 0.240;
  fill(14, 12, 11); noStroke();
  rect(tvX, tvY, tvW, tvH, 5 * sc);
  stroke(50, 46, 42); strokeWeight(0.8 * sc); noFill();
  rect(tvX + 1 * sc, tvY + 1 * sc, tvW - 2 * sc, tvH - 2 * sc, 4 * sc);
  noStroke();
  fill(8, 9, 12);
  rect(tvX + 7 * sc, tvY + 7 * sc, tvW - 14 * sc, tvH - 14 * sc, 2 * sc);
  let tvSheen = drawingContext.createLinearGradient(tvX + 7 * sc, tvY + 7 * sc, tvX + tvW * 0.55, tvY + tvH * 0.45);
  tvSheen.addColorStop(0,   'rgba(180,180,200,0.08)');
  tvSheen.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  tvSheen.addColorStop(1,   'rgba(0,0,0,0)');
  drawingContext.fillStyle = tvSheen;
  rect(tvX + 7 * sc, tvY + 7 * sc, tvW - 14 * sc, tvH - 14 * sc, 2 * sc);
  fill(40, 180, 100, 200);
  ellipse(tvX + tvW - 12 * sc, tvY + tvH - 8 * sc, 4 * sc, 4 * sc);

  // ── LEFT WALL SHELF ───────────────────────────────────────
  // Photo: shelf at roughly 38–43% height on left, full left panel width
  let shelfX = W * 0.002;
  let shelfY = H * 0.390;
  let shelfW = W * 0.195;           // slightly wider than before
  let shelfH = 14 * sc;

  // Rod
  let rodX = shelfX + shelfW * 0.44;
  fill(55, 48, 38); noStroke();
  rect(rodX, shelfY + shelfH, 7 * sc, H * 0.14, 3 * sc);
  fill(80, 70, 55);
  rect(rodX + 1 * sc, shelfY + shelfH, 2 * sc, H * 0.14, 3 * sc);


  // Shelf board
  let shelfGrad = drawingContext.createLinearGradient(shelfX, shelfY, shelfX, shelfY + shelfH);
  shelfGrad.addColorStop(0,   'rgb(128,88,48)');
  shelfGrad.addColorStop(0.3, 'rgb(108,72,36)');
  shelfGrad.addColorStop(1,   'rgb(74,50,24)');
  drawingContext.fillStyle = shelfGrad;
  rect(shelfX, shelfY, shelfW, shelfH, 3 * sc);
  drawingContext.fillStyle = 'rgba(255,220,140,0.18)';
  rect(shelfX, shelfY, shelfW, 2 * sc, 3 * sc);
  stroke(90, 60, 28, 60); strokeWeight(0.6 * sc);
  for (let g = 0; g < 4; g++) {
    let gx = shelfX + shelfW * (0.15 + g * 0.22);
    line(gx, shelfY + 2 * sc, gx + 6 * sc, shelfY + shelfH - 1 * sc);
  }
  noStroke();

  // ── SPEAKER (on shelf) ────────────────────────────────────
  // Photo: speaker is right portion of shelf, darker cylinder shape
  let spkX = shelfX + shelfW * 0.52;
  let spkY = shelfY - 72 * sc;
  let spkW = 64 * sc, spkH = 69 * sc;
  drawingContext.fillStyle = 'rgba(0,0,0,0.22)';
  drawingContext.beginPath();
  drawingContext.ellipse(spkX + spkW / 2 + 6 * sc, spkY + spkH + 2 * sc, spkW * 0.55, spkW * 0.18, 0, 0, Math.PI * 2);
  drawingContext.fill();
  let spkGrad = drawingContext.createLinearGradient(spkX, 0, spkX + spkW, 0);
  spkGrad.addColorStop(0,   'rgb(32,28,24)');
  spkGrad.addColorStop(0.3, 'rgb(26,22,18)');
  spkGrad.addColorStop(1,   'rgb(18,15,12)');
  fill(24, 20, 16); noStroke();
  ellipse(spkX + spkW / 2, spkY, spkW, spkW * 0.42);
  drawingContext.fillStyle = spkGrad;
  rect(spkX, spkY, spkW, spkH);
  fill(18, 15, 12);
  ellipse(spkX + spkW / 2, spkY + spkH, spkW, spkW * 0.42);
  stroke(55, 50, 44); strokeWeight(0.7 * sc);
  for (let i = 0; i < 7; i++) {
    line(spkX + 5 * sc, spkY + 9 * sc + i * 7.5 * sc, spkX + spkW - 5 * sc, spkY + 9 * sc + i * 7.5 * sc);
  }
  noStroke(); fill(14, 12, 10);
  ellipse(spkX + spkW / 2, spkY + spkH * 0.5, spkW * 0.38, spkW * 0.38);
  fill(28, 24, 20);
  ellipse(spkX + spkW / 2, spkY + spkH * 0.5, spkW * 0.18, spkW * 0.18);
  fill(90, 80, 60, 150);
  ellipse(spkX + spkW / 2, spkY + spkH * 0.5, spkW * 0.42, spkW * 0.42);
  fill(14, 12, 10);
  ellipse(spkX + spkW / 2, spkY + spkH * 0.5, spkW * 0.36, spkW * 0.36);
  noStroke();

  // ── PLANT (left shelf) ───────────────────────────────────
  let plX = shelfX + shelfW * 0.05;
  let plY = shelfY;
  drawingContext.fillStyle = 'rgba(0,0,0,0.18)';
  ellipse(plX + 10 * sc, plY + 1 * sc, 22 * sc, 5 * sc);
  let potGrad = drawingContext.createLinearGradient(plX, plY - 24 * sc, plX + 22 * sc, plY);
  potGrad.addColorStop(0,   'rgb(90,55,32)');
  potGrad.addColorStop(0.4, 'rgb(72,42,22)');
  potGrad.addColorStop(1,   'rgb(50,28,14)');
  drawingContext.fillStyle = potGrad;
  rect(plX, plY - 24 * sc, 28 * sc, 30 * sc, 10 * sc);
  fill(110, 68, 38);
  rect(plX, plY - 24 * sc, 22 * sc, 3 * sc, 2 * sc);
  for (let i = 0; i < 9; i++) {
    let lx = plX + 11 * sc + random(-22, 22) * sc;
    let ly = plY - 26 * sc + random(-40, -4) * sc;
    let lw = random(10, 26) * sc;
    let lh = random(6, 18) * sc;
    let ang = random(-0.8, 0.8);
    let gr = random(50, 90);
    fill(20, gr, 32, random(170, 240));
    push(); translate(lx, ly); rotate(ang);
    ellipse(0, 0, lw, lh);
    stroke(15, gr - 20, 22, 80); strokeWeight(0.5 * sc);
    line(0, -lh * 0.4, 0, lh * 0.4);
    noStroke();
    pop();
  }

  // ── HEADPHONES (wall below shelf) ────────────────────────
  // Photo: headphones hang on wall, below shelf, fairly large
  let hpX = shelfX + shelfW * 0.06;
  let hpY = shelfY + shelfH + H * 0.045;
  drawHeadphones(hpX, hpY, 130 * sc);

  // ── RIGHT WALL — STICKY NOTE ──────────────────────────────
  // Photo: top-right, large sticky, right of mirror
  let stX = W * 0.858, stY = H * 0.062;
  let stW = 122 * sc, stH = 156 * sc;
  drawingContext.fillStyle = 'rgba(0,0,0,0.20)';
  rect(stX + 4 * sc, stY + 4 * sc, stW, stH, 2 * sc);
  fill(210, 205, 178, 155); noStroke();
  rect(stX + stW / 2 - 16 * sc, stY - 9 * sc, 32 * sc, 13 * sc, 2 * sc);
  let noteGrad = drawingContext.createLinearGradient(stX, stY, stX + stW, stY + stH);
  noteGrad.addColorStop(0,   'rgb(244,232,194)');
  noteGrad.addColorStop(0.5, 'rgb(234,222,182)');
  noteGrad.addColorStop(1,   'rgb(218,206,166)');
  drawingContext.fillStyle = noteGrad;
  rect(stX, stY, stW, stH, 2 * sc);
  fill(200, 188, 152);
  triangle(stX + stW - 18 * sc, stY + stH, stX + stW, stY + stH - 18 * sc, stX + stW, stY + stH);
  fill(228, 216, 178);
  triangle(stX + stW - 18 * sc, stY + stH, stX + stW, stY + stH - 18 * sc, stX + stW - 4 * sc, stY + stH - 4 * sc);
  stroke(185, 172, 138, 140); strokeWeight(0.7 * sc);
  for (let i = 0; i < 9; i++) {
    let ly2 = stY + 24 * sc + i * 15 * sc;
    if (ly2 < stY + stH - 10 * sc) line(stX + 8 * sc, ly2, stX + stW - 10 * sc, ly2);
  }
  noStroke();
  textFont('Georgia'); textStyle(NORMAL);
  let items = [
    { done: true,  text: 'Study' },
    { done: true,  text: 'Workout' },
    { done: true, text: 'Read 30p' },
    { done: true, text: 'Sleep 23:00' },
  ];
  for (let i = 0; i < items.length; i++) {
    let iy = stY + 24 * sc + i * 30 * sc;
    if (items[i].done) {
      fill(50, 110, 55); textSize(13 * sc);
      text('✓', stX + 9 * sc, iy);
    } else {
      fill(155, 130, 95, 180); textSize(10 * sc);
      ellipse(stX + 14 * sc, iy - 4 * sc, 8 * sc, 8 * sc);
    }
    if (items[i].done) fill(140, 130, 105);
    else fill(38, 34, 26);
    textSize(14 * sc);
    text(items[i].text, stX + 50 * sc, iy);
  }
  textStyle(NORMAL);

  // ── RIGHT WALL — MOTIVATIONAL CARD ───────────────────────
  // Photo: black card below sticky note
  let cardX = W * 0.845, cardY = H * 0.340;
  let cardW = 138 * sc, cardH = 110 * sc;
  drawingContext.fillStyle = 'rgba(0,0,0,0.28)';
  rect(cardX + 5 * sc, cardY + 5 * sc, cardW, cardH, 3 * sc);
  fill(150, 145, 128, 130); noStroke();
  rect(cardX + cardW / 2 - 13 * sc, cardY - 8 * sc, 26 * sc, 11 * sc, 2 * sc);
  let cardGrad = drawingContext.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
  cardGrad.addColorStop(0, 'rgb(24,22,19)');
  cardGrad.addColorStop(1, 'rgb(16,14,11)');
  drawingContext.fillStyle = cardGrad;
  rect(cardX, cardY, cardW, cardH, 3 * sc);
  stroke(52, 48, 40); strokeWeight(0.8 * sc); noFill();
  rect(cardX, cardY, cardW, cardH, 3 * sc);
  noStroke();
  fill(238, 234, 228);
  textFont('Georgia'); textStyle(ITALIC); textSize(26 * sc); textAlign(LEFT);
  text('you',  cardX + 16 * sc, cardY + 46 * sc);
  text('can.', cardX + 16 * sc, cardY + 76 * sc);
  stroke(80, 74, 60); strokeWeight(0.6 * sc);
  line(cardX + 14 * sc, cardY + 75 * sc, cardX + cardW - 14 * sc, cardY + 75* sc);
  noStroke(); textStyle(NORMAL);

  // ── RIGHT FLOOR PLANT (partially cropped at right edge) ──
  // Photo: plant pot is at very right edge, leaves cropped by frame
  let rplX = W * 0.968, rplY = H * 0.50;
  drawingContext.fillStyle = 'rgba(0,0,0,0.28)';
  ellipse(rplX, H * 0.985, 64 * sc, 14 * sc);
  let rPotGrad = drawingContext.createLinearGradient(rplX - 32 * sc, rplY, rplX + 32 * sc, rplY);
  rPotGrad.addColorStop(0,   'rgb(50,40,30)');
  rPotGrad.addColorStop(0.4, 'rgb(35,28,20)');
  rPotGrad.addColorStop(1,   'rgb(22,17,12)');
  drawingContext.fillStyle = rPotGrad;
  rect(rplX - 30 * sc, rplY, 60 * sc, 68 * sc, 4 * sc);
  fill(60, 48, 34); noStroke();
  ellipse(rplX, rplY, 66 * sc, 18 * sc);
  fill(38, 30, 20);
  ellipse(rplX, rplY, 55 * sc, 14 * sc);
  for (let i = 0; i < 26; i++) {
    let ang2 = random(-1.4, 1.4);
    let lx2 = rplX + cos(ang2) * random(0, 28) * sc;
    let ly2 = rplY + random(-100, -8) * sc;
    let green = random(62, 118);
    fill(random(14, 38), green, random(28, 52), random(155, 225));
    push();
    translate(lx2, ly2);
    rotate(random(-0.65, 0.65));
    ellipse(0, 0, random(10, 32) * sc, random(28, 78) * sc);
    fill(255, 255, 255, 20);
    ellipse(-2 * sc, 0, random(3, 7) * sc, random(16, 40) * sc);
    noStroke();
    pop();
  }

  // ── DESK SURFACE ──────────────────────────────────────────
  let deskY = H * 0.948;
  let deskGrad = drawingContext.createLinearGradient(0, deskY, 0, H);
  deskGrad.addColorStop(0,   'rgb(24,19,14)');
  deskGrad.addColorStop(0.2, 'rgb(18,14,10)');
  deskGrad.addColorStop(1,   'rgb(9,7,5)');
  drawingContext.fillStyle = deskGrad;
  rect(0, deskY, W, H - deskY);
  let deskEdge = drawingContext.createLinearGradient(0, deskY, W, deskY);
  deskEdge.addColorStop(0,    'rgba(255,195,90,0.22)');
  deskEdge.addColorStop(0.35, 'rgba(255,185,80,0.12)');
  deskEdge.addColorStop(0.6,  'rgba(255,195,90,0.18)');
  deskEdge.addColorStop(1,    'rgba(255,175,70,0.08)');
  drawingContext.fillStyle = deskEdge;
  rect(0, deskY, W, 3 * sc);
  let deskRefl = drawingContext.createLinearGradient(0, deskY, 0, deskY + H * 0.06);
  deskRefl.addColorStop(0, 'rgba(255,185,75,0.09)');
  deskRefl.addColorStop(1, 'rgba(0,0,0,0)');
  drawingContext.fillStyle = deskRefl;
  rect(0, deskY, W, H * 0.06);

  // ── BOTTOM-LEFT: BOOKS + MUG ──────────────────────────────
  // Photo: books stand on desk left side, mug next to them
  drawBooksLeft(W * 0.025, deskY, sc);
  drawMug(W * 0.115, deskY - 52 * sc, sc);

  // ── BOTTOM-RIGHT: NIGHTSTAND ──────────────────────────────
  // Photo: nightstand fills right side below mirror, lamp on top
  let nsX = W * 0.760, nsY = H * 0.758;
  let nsW = W * 0.248, nsH = H * 0.242;
  drawingContext.fillStyle = 'rgba(0,0,0,0.45)';
  rect(nsX + 6 * sc, nsY + 6 * sc, nsW, nsH, 4 * sc);
  let nsGrad = drawingContext.createLinearGradient(nsX, nsY, nsX + nsW, nsY + nsH);
  nsGrad.addColorStop(0, 'rgb(26,21,16)');
  nsGrad.addColorStop(1, 'rgb(16,13,9)');
  drawingContext.fillStyle = nsGrad;
  rect(nsX, nsY, nsW, nsH, 4 * sc);
  fill(30, 25, 18); noStroke();
  rect(nsX + 7 * sc, nsY + 7 * sc, nsW - 14 * sc, nsH - 14 * sc, 2 * sc);
  stroke(50, 42, 32); strokeWeight(0.7 * sc); noFill();
  rect(nsX + 7 * sc, nsY + 7 * sc, nsW - 14 * sc, nsH - 14 * sc, 2 * sc);
  noStroke();
  fill(18, 14, 10);
  rect(nsX + 7 * sc, nsY + nsH * 0.5 - 1.5 * sc, nsW - 14 * sc, 3 * sc);
  drawBooksRight(nsX + 10 * sc, nsY + 9 * sc, nsW - 20 * sc, nsH - 18 * sc, sc);

  // ── TABLE LAMP ────────────────────────────────────────────
  // Photo: white cylindrical lamp on nightstand, glowing warm
  let lampX = W * 0.832, lampY = nsY - 66 * sc;
  let lampW = 50 * sc, lampH = 72 * sc;

  let lampGlow = drawingContext.createRadialGradient(
    lampX + lampW / 2, lampY + lampH * 0.45, 0,
    lampX + lampW / 2, lampY + lampH * 0.45, lampW * 2.4
  );
  lampGlow.addColorStop(0,    'rgba(255,245,210,0.50)');
  lampGlow.addColorStop(0.3,  'rgba(255,225,155,0.24)');
  lampGlow.addColorStop(0.65, 'rgba(255,200,100,0.10)');
  lampGlow.addColorStop(1,    'rgba(255,185,70,0)');
  drawingContext.fillStyle = lampGlow;
  ellipse(lampX + lampW / 2, lampY + lampH * 0.45, lampW * 4.8, lampH * 3.8);

  drawingContext.save();
  let coneGrad = drawingContext.createRadialGradient(
    lampX + lampW / 2, lampY + lampH, 0,
    lampX + lampW / 2, lampY + lampH, lampW * 2.0
  );
  coneGrad.addColorStop(0,   'rgba(255,220,130,0.34)');
  coneGrad.addColorStop(0.5, 'rgba(255,200,90,0.14)');
  coneGrad.addColorStop(1,   'rgba(255,185,60,0)');
  drawingContext.fillStyle = coneGrad;
  drawingContext.beginPath();
  drawingContext.moveTo(lampX + lampW / 2, lampY + lampH);
  drawingContext.lineTo(lampX - lampW * 0.9, nsY + 4 * sc);
  drawingContext.lineTo(lampX + lampW * 1.9, nsY + 4 * sc);
  drawingContext.closePath();
  drawingContext.fill();
  drawingContext.restore();

  let shadeGrad = drawingContext.createLinearGradient(lampX, 0, lampX + lampW, 0);
  shadeGrad.addColorStop(0,    'rgb(255,252,240)');
  shadeGrad.addColorStop(0.35, 'rgb(250,248,232)');
  shadeGrad.addColorStop(0.7,  'rgb(238,234,218)');
  shadeGrad.addColorStop(1,    'rgb(210,205,186)');
  drawingContext.fillStyle = shadeGrad;
  fill(252, 250, 238); noStroke();
  ellipse(lampX + lampW / 2, lampY, lampW, lampW * 0.34);
  drawingContext.fillStyle = shadeGrad;
  rect(lampX, lampY, lampW, lampH);
  fill(230, 226, 210);
  ellipse(lampX + lampW / 2, lampY + lampH, lampW, lampW * 0.34);

  let lampInner = drawingContext.createRadialGradient(
    lampX + lampW / 2, lampY + lampH * 0.5, 0,
    lampX + lampW / 2, lampY + lampH * 0.5, lampW * 0.65
  );
  lampInner.addColorStop(0,   'rgba(255,255,248,0.92)');
  lampInner.addColorStop(0.6, 'rgba(255,245,210,0.38)');
  lampInner.addColorStop(1,   'rgba(255,235,180,0)');
  drawingContext.fillStyle = lampInner;
  ellipse(lampX + lampW / 2, lampY + lampH * 0.5, lampW * 1.05, lampH * 1.05);

  stroke(220, 215, 198); strokeWeight(0.5 * sc); noFill();
  line(lampX + lampW / 2, lampY, lampX + lampW / 2, lampY + lampH);
  noStroke();

  let castGlow = drawingContext.createRadialGradient(lampX + lampW / 2, nsY, 0, lampX + lampW / 2, nsY, lampW * 2.4);
  castGlow.addColorStop(0,   'rgba(255,215,105,0.32)');
  castGlow.addColorStop(0.5, 'rgba(255,200,80,0.14)');
  castGlow.addColorStop(1,   'rgba(255,190,60,0)');
  drawingContext.fillStyle = castGlow;
  ellipse(lampX + lampW / 2, nsY, lampW * 4.8, 34 * sc);

  // ── FINAL VIGNETTE ────────────────────────────────────────
  let finalV = drawingContext.createRadialGradient(W / 2, H * 0.44, H * 0.16, W / 2, H * 0.44, H * 0.9);
  finalV.addColorStop(0,    'rgba(0,0,0,0)');
  finalV.addColorStop(0.65, 'rgba(0,0,0,0.10)');
  finalV.addColorStop(1,    'rgba(0,0,0,0.44)');
  drawingContext.fillStyle = finalV;
  rect(0, 0, W, H);
}

// ════════════════════════════════════════════════════════
//  HEADPHONES
// ════════════════════════════════════════════════════════
function drawHeadphones(x, y, size) {
  let cx = x + size * 0.5;
  let cy = y + size * 0.28;
  let r  = size * 0.38;

  drawingContext.save();
  drawingContext.strokeStyle = 'rgba(0,0,0,0.3)';
  drawingContext.lineWidth = size * 0.16;
  drawingContext.beginPath();
  drawingContext.arc(cx + 3, cy + r * 0.25, r, -Math.PI, 0);
  drawingContext.stroke();
  drawingContext.restore();

  noFill(); stroke(22, 20, 18); strokeWeight(size * 0.13);
  arc(cx, cy + r * 0.22, r * 2, r * 1.72, -PI, 0, OPEN);
  stroke(50, 46, 42); strokeWeight(size * 0.04);
  arc(cx, cy + r * 0.22, r * 1.88, r * 1.58, -PI, 0, OPEN);
  noStroke();

  drawEarCup(cx - r * 0.95, cy + r * 0.62, size);
  drawEarCup(cx + r * 0.95, cy + r * 0.62, size);
  noStroke();
}

function drawEarCup(ex, ey, size) {
  fill(30, 27, 24);
  ellipse(ex, ey, size * 0.37, size * 0.46);
  fill(20, 18, 15);
  ellipse(ex, ey, size * 0.26, size * 0.33);
  fill(12, 10, 8);
  ellipse(ex, ey, size * 0.16, size * 0.20);
  fill(62, 58, 52, 160);
  ellipse(ex - size * 0.06, ey - size * 0.08, size * 0.07, size * 0.05);
}

// ════════════════════════════════════════════════════════
//  BOOKS LEFT (on desk)
// ════════════════════════════════════════════════════════
function drawBooksLeft(x, deskY, sc) {
  push();
  scale(2.3,1)
  translate(-10,0)
  
  let bookData = [
    { w: 17 * sc, h: 134 * sc, col: [42,36,30],  spine: [64,52,42],  title: 'KRONOS' },
    { w: 14 * sc, h: 126 * sc, col: [56,48,38],  spine: [82,70,56],  title: 'THE PRINCE' },
    { w: 19 * sc, h: 142 * sc, col: [34,30,24],  spine: [56,46,36],  title: 'MEDITATIONS' },
    { w: 13 * sc, h: 130 * sc, col: [46,40,32],  spine: [70,60,48],  title: 'SLEEP' },
    { w: 16 * sc, h: 120 * sc, col: [38,44,36],  spine: [58,70,52],  title: 'STOIC' },
  ];
  let bx = x;
  for (let b of bookData) {
    let by = deskY - b.h - 2 * sc;
    fill(0, 0, 0, 55); noStroke();
    rect(bx + b.w - 2 * sc, by + 4 * sc, 3 * sc, b.h - 4 * sc);
    let bg = drawingContext.createLinearGradient(bx, by, bx + b.w, by);
    bg.addColorStop(0,    `rgb(${b.spine[0]},${b.spine[1]},${b.spine[2]})`);
    bg.addColorStop(0.14, `rgb(${b.col[0]},${b.col[1]},${b.col[2]})`);
    bg.addColorStop(0.85, `rgb(${(b.col[0]*0.82)|0},${(b.col[1]*0.82)|0},${(b.col[2]*0.82)|0})`);
    bg.addColorStop(1,    `rgb(${(b.col[0]*0.6)|0},${(b.col[1]*0.6)|0},${(b.col[2]*0.6)|0})`);
    drawingContext.fillStyle = bg;
    rect(bx, by, b.w, b.h);
    let topG = drawingContext.createLinearGradient(bx, by - 4 * sc, bx, by);
    topG.addColorStop(0, `rgba(${b.col[0]+40},${b.col[1]+36},${b.col[2]+30},1)`);
    topG.addColorStop(1, `rgba(${b.col[0]},${b.col[1]},${b.col[2]},1)`);
    drawingContext.fillStyle = topG;
    rect(bx, by - 3 * sc, b.w, 3 * sc);
    push();
    fill(160, 148, 128, 190);
    textFont('Arial'); textSize(6 * sc); textStyle(BOLD);
    translate(bx + b.w * 0.5, by + b.h * 0.5);
    rotate(-PI / 2);
    textAlign(CENTER, CENTER);
    text(b.title, 0, 0);
    pop();
    bx += b.w + 2 * sc;
  }
  pop();
}

// ════════════════════════════════════════════════════════
//  MUG
// ════════════════════════════════════════════════════════
function drawMug(x, y, sc) {
  let mw = 40 * sc, mh = 48 * sc;
  drawingContext.fillStyle = 'rgba(0,0,0,0.30)';
  drawingContext.beginPath();
  drawingContext.ellipse(x + mw / 2, y + mh + 3 * sc, mw * 0.58, 6 * sc, 0, 0, Math.PI * 2);
  drawingContext.fill();
  let mugGrad = drawingContext.createLinearGradient(x, 0, x + mw, 0);
  mugGrad.addColorStop(0,    'rgb(38,34,30)');
  mugGrad.addColorStop(0.3,  'rgb(28,24,20)');
  mugGrad.addColorStop(0.85, 'rgb(20,17,14)');
  mugGrad.addColorStop(1,    'rgb(12,10,8)');
  drawingContext.fillStyle = mugGrad;
  noStroke();
  beginShape();
  vertex(x + mw * 0.04, y);
  vertex(x + mw * 0.96, y);
  vertex(x + mw * 0.88, y + mh);
  vertex(x + mw * 0.12, y + mh);
  endShape(CLOSE);
  fill(46, 42, 36);
  ellipse(x + mw / 2, y, mw, mw * 0.28);
  fill(22, 18, 14);
  ellipse(x + mw / 2, y, mw * 0.78, mw * 0.20);
  fill(10, 8, 6);
  ellipse(x + mw / 2, y, mw * 0.78, mw * 0.20);
  fill(32, 24, 16, 160);
  arc(x + mw / 2, y, mw * 0.78, mw * 0.20, PI, TWO_PI);
  fill(16, 13, 10);
  ellipse(x + mw / 2, y + mh, mw * 0.88, mw * 0.22);
  noFill(); stroke(28, 24, 20); strokeWeight(5.5 * sc);
  arc(x + mw + 4 * sc, y + mh * 0.44, 24 * sc, 28 * sc, -PI * 0.5, PI * 0.5);
  stroke(48, 42, 36); strokeWeight(2 * sc);
  arc(x + mw + 3 * sc, y + mh * 0.44, 22 * sc, 26 * sc, -PI * 0.5, PI * 0.5);
  noStroke();
  stroke(200, 195, 185, 45); strokeWeight(1 * sc);
  noFill();
  for (let s = 0; s < 3; s++) {
    let sx = x + mw * (0.28 + s * 0.22);
    beginShape();
    for (let t = 0; t < 8; t++) {
      let ty = y - 6 * sc - t * 5 * sc;
      let tx = sx + sin(t * 0.9 + s * 2) * 3 * sc;
      curveVertex(tx, ty);
    }
    endShape();
  }
  noStroke();
}

// ════════════════════════════════════════════════════════
//  BOOKS RIGHT (on nightstand)
// ════════════════════════════════════════════════════════
function drawBooksRight(x, y, w, h, sc) {
  push()
  translate(100,0)
  scale(3,1)
  let books = [
    { bw: 15 * sc, col: [92,86,76],   title: 'bauhaus' },
    { bw: 11 * sc, col: [108,100,90], title: 'ess' },
    { bw: 14 * sc, col: [80,74,64],   title: 'kinfolk' },
    { bw: 12 * sc, col: [96,90,80],   title: 'design' },
  ];
  let bx = x + 5 * sc;
  for (let b of books) {
    let by = y + 5 * sc;
    let bh = (h - 10 * sc) * 0.9;
    fill(0, 0, 0, 50); noStroke();
    rect(bx + b.bw - 2 * sc, by + 3 * sc, 3 * sc, bh - 3 * sc);
    let bg2 = drawingContext.createLinearGradient(bx, by, bx + b.bw, by);
    bg2.addColorStop(0,   `rgb(${b.col[0]},${b.col[1]},${b.col[2]})`);
    bg2.addColorStop(0.2, `rgb(${(b.col[0]*0.9)|0},${(b.col[1]*0.9)|0},${(b.col[2]*0.9)|0})`);
    bg2.addColorStop(1,   `rgb(${(b.col[0]*0.68)|0},${(b.col[1]*0.68)|0},${(b.col[2]*0.68)|0})`);
    drawingContext.fillStyle = bg2;
    rect(bx, by, b.bw, bh);
    fill(b.col[0] + 20, b.col[1] + 18, b.col[2] + 14); noStroke();
    rect(bx, by - 2 * sc, b.bw, 2 * sc);
    push();
    fill(42, 38, 33, 200);
    textFont('Arial'); textSize(5.5 * sc); textStyle(NORMAL);
    translate(bx + b.bw * 0.5, by + bh * 0.5);
    rotate(-PI / 2);
    textAlign(CENTER, CENTER);
    text(b.title, 0, 0);
    pop();
    bx += b.bw + 3 * sc;
  }
  pop()
}


// ════════════════════════════════════════════════════════
//  AMBIENT ROOM GLOW (behind mirror)
// ════════════════════════════════════════════════════════
function drawAmbientRoom() {
  // Mirror will be centred around W*0.27 → W*0.75
  let cx = W * 0.27 + W * 0.48 / 2;
  let cy = H * 0.10 + H * 0.95 / 2;
  noStroke();
  for (let r = 340; r > 0; r -= 8) {
    let alpha = map(r, 340, 0, 0, 14);
    fill(200, 170, 100, alpha);
    ellipse(cx, cy, r * 2.2, r * 1.8);
  }
}

// ════════════════════════════════════════════════════════
//  MIRROR
// ════════════════════════════════════════════════════════
function drawMirror() {
  // Photo analysis:
  //   Mirror left edge  ≈ W * 0.27
  //   Mirror right edge ≈ W * 0.755
  //   Mirror top        ≈ H * 0.04
  //   Mirror extends past bottom of canvas

  let mX = W * 0.2568;
  let mY = H * 0.0735;
  let mW = W * 0.467;    // ~50% of width
  let mH = H * 1.02;     // taller than canvas so bottom clips
  let cut = mW * 0.088;

  let pts = [
    [mX + cut,       mY],
    [mX + mW - cut,  mY],
    [mX + mW,        mY + cut],
    [mX + mW,        mY + mH - cut],
    [mX + mW - cut,  mY + mH],
    [mX + cut,       mY + mH],
    [mX,             mY + mH - cut],
    [mX,             mY + cut],
  ];

  // 1. Drop shadows
  noStroke();
  fill(0, 0, 0, 40); drawShape(pts, 20, 24);
  fill(0, 0, 0, 26); drawShape(pts, 12, 15);
  fill(0, 0, 0, 14); drawShape(pts, 5, 7);

  // 2. Frame base (thick dark gold undercoat)
  stroke(90, 72, 30); strokeWeight(30); strokeJoin(MITER); noFill();
  drawShape(pts, 0, 0);

  // 3. Webcam mirror

  drawingContext.save();

  drawingContext.beginPath();

  drawingContext.moveTo(pts[0][0], pts[0][1]);

  for(let i=1;i<pts.length;i++){
    drawingContext.lineTo(
      pts[i][0],
      pts[i][1]
    );
  }

  drawingContext.closePath();
  drawingContext.clip();

  imageMode(CORNER);
  image(video, mX, mY, mW, mH);

if (poses.length > 0) {
    let pose = poses[0];
    drawEquipment(mapPoseToFrame(pose));
  }

  drawingContext.restore();

  
  

  

  // 6. White matte inner border
  noFill(); stroke(255, 255, 255, 12); strokeWeight(10); strokeJoin(MITER);
  drawShape(pts, 0, 0);

  // 7. Gold frame — dark base stroke
  stroke(100, 78, 28); strokeWeight(14); strokeJoin(MITER); noFill();
  drawShape(pts, 0, 0);

  // 8. Gold frame — main colour
  stroke(190, 158, 82); strokeWeight(9);
  drawShape(pts, 0, 0);

  // 9. Gold frame — highlight (top/left edges)
  stroke(235, 210, 140); strokeWeight(2.8);
  line(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
  line(pts[7][0], pts[7][1], pts[0][0], pts[0][1]);

  // 10. Inner double line
  let innerPts = padShape(pts, -13);
  noFill(); stroke(160, 130, 58, 200); strokeWeight(1.0);
  drawShape(innerPts, 0, 0);
  let innerPts2 = padShape(pts, -18);
  stroke(130, 104, 42, 120); strokeWeight(0.6);
  drawShape(innerPts2, 0, 0);

  // 11. Outer thin double line
  let outerLinePts = padShape(pts, 11);
  stroke(150, 118, 48, 130); strokeWeight(0.8);
  drawShape(outerLinePts, 0, 0);

  // 12. Corner jewel points
  for (let i = 0; i < pts.length; i++) {
    let p = pts[i];
    stroke(240, 215, 150, 220); strokeWeight(3.5);
    point(p[0], p[1]);
    stroke(255, 245, 200, 100); strokeWeight(7);
    point(p[0], p[1]);
    let next = pts[(i + 1) % pts.length];
    let mx = (p[0] + next[0]) / 2;
    let my = (p[1] + next[1]) / 2;
    stroke(210, 180, 100, 160); strokeWeight(2.5);
    point(mx, my);
  }

  // 13. Top micro highlight
  noFill(); stroke(255, 248, 220, 60); strokeWeight(0.8);
  let topHighPts = padShape(pts, -4);
  line(topHighPts[0][0], topHighPts[0][1], topHighPts[1][0], topHighPts[1][1]);
  line(topHighPts[7][0], topHighPts[7][1], topHighPts[0][0], topHighPts[0][1]);

  // 14. Smart mirror UI — clock
  let txtX = mX + mW * 0.10;
  let txtY = mY + mH * 0.088;
  drawClockUI(txtX, txtY, mW, mH);

  // 15. Smart mirror UI — weather widget
  drawWeatherWidget(mX + mW * 0.10, mY + mH * 0.815, mW);
}

// ════════════════════════════════════════════════════════
//  CLOCK UI
// ════════════════════════════════════════════════════════
function drawClockUI(x, y, mW, mH) {
  fill(200, 185, 145, 170); noStroke();
  textSize(13);
  textStyle(NORMAL);
  text('2026  •  05  •  30', x, y);

  fill(170, 155, 115, 130);
  textSize(11);
  text('W E D N E S D A Y', x, y + 18);

  noFill();
  stroke(196, 166, 97, 100); strokeWeight(0.6);
  line(x, y + 26, x + 60, y + 26);
  stroke(220, 196, 130, 180); strokeWeight(0.8);
  line(x + 60, y + 26, x + 110, y + 26);
  stroke(196, 166, 97, 80); strokeWeight(0.6);
  line(x + 110, y + 26, x + 150, y + 26);

  noStroke();
  fill(220, 195, 120, 40);
  textSize(68); textStyle(BOLD);
  text('08:30', x - 3, y + 88);

  fill(238, 218, 148, 240);
  textSize(66);
  text('08:30', x - 4, y + 86);

  fill(180, 158, 95, 180);
  textSize(12); textStyle(NORMAL);
  text('AM', x + 200, y + 64);
}

// ════════════════════════════════════════════════════════
//  WEATHER WIDGET
// ════════════════════════════════════════════════════════
function drawWeatherWidget(x, y, mW) {
  noStroke();
  fill(180, 165, 120, 140);
  textSize(12); textStyle(NORMAL);
  text('Seoul  ·  Partly Cloudy', x, y);

  fill(220, 205, 155, 180);
  textSize(26); textStyle(BOLD);
  text('18°', x, y + 28);

  fill(160, 148, 108, 120);
  textSize(11); textStyle(NORMAL);
  text('Feels like 16°   ↑22°  ↓12°', x, y + 55);
}

// ════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════
function drawShape(pts, dx, dy) {
  beginShape();
  for (let p of pts) vertex(p[0] + (dx || 0), p[1] + (dy || 0));
  endShape(CLOSE);
}

function padShape(pts, pad) {
  let cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  let cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(p => {
    let dx = p[0] - cx;
    let dy = p[1] - cy;
    let d = Math.sqrt(dx * dx + dy * dy);
    return [p[0] + (dx / d) * pad, p[1] + (dy / d) * pad];
  });
}