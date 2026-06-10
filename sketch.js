let video;
let bodyPose;
let poses = [];

// [AI 분류기 변수]
let commonClassifier;
let dailyClassifier;

let currentLabel = "요일을 선택해주세요"; 
let activeModelName = "대기중"; 

let imgBody, imgShoulder, imgGlove, imgHelmet, imgSword;

let itemCount = 0; 
let isDailyLoaded = false; 

// 카메라 예열 확인용 변수
let isAppReady = false; 

// 실제 학습시킨 TM 클래스명 (대소문자 무관하게 작동함)
let commonItems = ["Wallet", "Phone"];

// ✅ [버그 수정 1] 요일별 dailyItems 개별 정의
//    → 각 요일 모델의 실제 클래스명에 맞게 수정하세요
const dailyItemsMap = {
  Mon: ["Book", "Pencil", "Ruler", "Eraser"],      // 월요일 모델 클래스명
  Tue: ["Scissors", "Glue", "Notebook", "Pen"],    // 화요일 모델 클래스명
  Wed: ["Future", "Creative", "English", "Japanese"], // 수요일 모델 클래스명
  Thu: ["Cup", "Bottle", "Bag", "Umbrella"],        // 목요일 모델 클래스명
  Fri: ["Hat", "Jacket", "Shoes", "Watch"],         // 금요일 모델 클래스명
};

let dailyItems = []; // 선택된 요일의 아이템 (버튼 누르면 갱신됨)
let selectedDay = ""; // 현재 선택된 요일

let foundItems = []; 
let activeTargetInView = ""; 

// [시간 게이지용 변수]
let currentConfidence = 0;  
let holdTime = 0;           
const REQUIRED_TIME = 1000; 

// ✅ [버그 수정 2] classifyVideo 루프 안전 제어용 플래그
let isClassifying = false;

function preload() {
  bodyPose = ml5.bodyPose({ flipped: true });
  commonClassifier = ml5.imageClassifier('http://127.0.0.1:5500/Models/Common/model.json');
  
  imgBody = loadImage('Images/BodyArmor.png');
  imgShoulder = loadImage('Images/Shoulder.png'); 
  imgGlove = loadImage('Images/Hand.png');        
  imgHelmet = loadImage('Images/Hellmet.png');
  imgSword = loadImage('Images/Sword.png');
}

function setup() {
  createCanvas(640, 480);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  
  bodyPose.detectStart(video, gotPoses);
  imageMode(CENTER);

  createDayButtons();

  // 카메라 예열 후 분류 시작
  setTimeout(() => { 
    isAppReady = true; 
    console.log("카메라 예열 완료! 이제 인식 시작합니다.");
    classifyVideo(); // ✅ 예열 완료 후에 분류 시작 (setup에서 즉시 호출 제거)
  }, 2000); 
}

function draw() {
  push();
  imageMode(CORNER);
  image(video, 0, 0, width, height);
  pop();

  if (poses.length > 0) {
    let pose = poses[0];
    drawDebugPoints(pose);
    drawEquipment(pose);
  }

  checkLevelUp(); 
  drawProgressBar();
  drawStatusUI();
  drawAIFeedback();
}

function gotPoses(results) {
  poses = results;
}

function classifyVideo() {
  // ✅ [버그 수정 2] 이미 분류 중이면 중복 호출 방지
  if (isClassifying) return;

  if (itemCount < 2) {
    isClassifying = true;
    activeModelName = "Common Model";
    commonClassifier.classify(video, gotResult);
  } else if (itemCount >= 2 && isDailyLoaded) {
    isClassifying = true;
    activeModelName = `Daily Model (${selectedDay})`;
    dailyClassifier.classify(video, gotResult);
  } else if (itemCount >= 2 && !isDailyLoaded) {
    // 요일 미선택 상태 → 500ms 후 재시도 (isClassifying은 false 유지)
    currentLabel = "⚠️ 아래 버튼으로 요일을 선택하세요!";
    setTimeout(classifyVideo, 500); 
  }
}

function gotResult(results) {
  isClassifying = false; // ✅ 분류 완료 → 플래그 해제
  currentLabel = results[0].label;
  currentConfidence = results[0].confidence;
  classifyVideo(); // 다음 분류 요청
}

function checkLevelUp() {
  // 예열 안 끝났거나 화면에 사람이 없으면 차단
  if (!isAppReady) {
    holdTime = 0;
    activeTargetInView = "";
    return;
  }

  // ✅ [버그 수정 1] 현재 단계에 맞는 올바른 아이템 목록 사용
  let validTargets;
  if (itemCount < 2) {
    validTargets = commonItems;
  } else {
    // dailyItems가 비어있으면 (요일 미선택) 게이지 진행 안 함
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

  if (isTargetMatch && currentConfidence >= 0.6) {
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
    holdTime = 0; 
    activeTargetInView = "";

    // ✅ itemCount가 2가 됐을 때 Daily 모델이 이미 로드됐으면 즉시 전환
    if (itemCount === 2 && isDailyLoaded && !isClassifying) {
      classifyVideo();
    }
  }
}

function drawProgressBar() {
  if (itemCount < 6) {
    let progress = constrain(holdTime / REQUIRED_TIME, 0, 1); 
    let angle = progress * TWO_PI; 

    push();
    translate(width / 2, height / 2);

    noFill();
    stroke(255, 255, 255, 80);
    strokeWeight(20); 
    circle(0, 0, 180); 

    if (holdTime > 0) {
      stroke(0, 255, 100);
      strokeWeight(20);
      strokeCap(ROUND); 
      arc(0, 0, 180, 180, -PI / 2, -PI / 2 + angle);
    }

    fill(255);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(36); 
    text(`${Math.floor(progress * 100)}%`, 0, -10);
    
    textSize(18);
    if (holdTime > 0) {
       fill(0, 255, 100);
       text(`[${activeTargetInView}] 장착 중!`, 0, 40);
    } else {
       fill(200, 200, 200);
       // 요일 미선택 시 안내 메시지
       if (itemCount >= 2 && dailyItems.length === 0) {
         fill(255, 200, 0);
         text(`요일을 선택하세요!`, 0, 40);
       } else {
         text(`대기 중...`, 0, 40);
       }
    }
    pop();
  }
}

function drawAIFeedback() {
  let validTargets = (itemCount < 2) ? commonItems : dailyItems;
  let remainingItems = validTargets.filter(item => !foundItems.includes(item));
  let targetText = (remainingItems.length > 0) ? remainingItems.join(", ") : "완료!";

  push();
  translate(width / 2 - 150, height - 90); 
  
  fill(0, 180);
  noStroke();
  rect(0, 0, 300, 75, 10);

  fill(255, 255, 0);
  textSize(14);
  textAlign(LEFT, TOP);
  if (itemCount < 6) {
    text(`🎯 남은 준비물: ${targetText}`, 15, 10);
  } else {
    text(`🎉 모든 장비 장착 완료!`, 15, 10);
  }

  fill(255);
  textSize(14);
  let percent = Math.floor(currentConfidence * 100);
  text(`👁️ 현재 인식중: ${currentLabel} (${percent}%)`, 15, 35);

  fill(100);
  rect(15, 55, 270, 8, 4);
  
  if (currentConfidence > 0.8) fill(0, 255, 100); 
  else fill(255, 100, 100); 
  rect(15, 55, 270 * currentConfidence, 8, 4);
  
  pop();
}

function createDayButtons() {
  let days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  let labels = ['월요일', '화요일', '수요일', '목요일', '금요일'];
  
  for (let i = 0; i < days.length; i++) {
    let btn = createButton(labels[i]);
    btn.position(10 + (i * 70), 500); 
    btn.mousePressed(() => {
      // ✅ [버그 수정 1] 요일 선택 시 해당 요일의 dailyItems로 교체
      selectedDay = days[i];
      dailyItems = dailyItemsMap[days[i]];

      isDailyLoaded = false;
      isClassifying = false; // 혹시 stuck된 분류 루프 리셋
      currentLabel = `${labels[i]} 모델 로딩중...`;
      
      dailyClassifier = ml5.imageClassifier(
        `http://127.0.0.1:5500/Models/${days[i]}/model.json`, 
        () => {
          isDailyLoaded = true;
          currentLabel = `${labels[i]} 모델 로드 완료!`;
          console.log(`${labels[i]} 모델 로드됨. dailyItems:`, dailyItems);

          // ✅ 모델 로드 완료 시점에 itemCount >= 2 이면 즉시 Daily 모델로 전환
          if (itemCount >= 2 && !isClassifying) {
            classifyVideo();
          }
        }
      );
    });
  }
}

function getPoint(pose, partName) {
  if (!pose || !pose.keypoints) return null;
  let keypoint = pose.keypoints.find(k => k.name === partName);
  if (keypoint?.confidence > 0.1) return keypoint;
  return null;
}

function drawDebugPoints(pose) {
  if (!pose || !pose.keypoints) return;
  fill(255, 255, 255, 150);
  noStroke();
  for (let i = 0; i < pose.keypoints.length; i++) {
    let kp = pose.keypoints[i];
    if (kp && kp.confidence > 0.1) circle(kp.x, kp.y, 8);
  }
}

function drawEquipment(pose) {
  let nose = getPoint(pose, 'nose');
  let lEar = getPoint(pose, 'left_ear');
  let rEar = getPoint(pose, 'right_ear');
  let lShoulder = getPoint(pose, 'left_shoulder');
  let rShoulder = getPoint(pose, 'right_shoulder');
  let lElbow = getPoint(pose, 'left_elbow');
  let rElbow = getPoint(pose, 'right_elbow');
  let lWrist = getPoint(pose, 'left_wrist');
  let rWrist = getPoint(pose, 'right_wrist');

  if (itemCount >= 1 && lShoulder && rShoulder) {
    let centerX = (lShoulder.x + rShoulder.x) / 2;
    let centerY = (lShoulder.y + rShoulder.y) / 2 + 100; 
    let bodyWidth = dist(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y) * 1.5;
    let bodyHeight = bodyWidth; 
    let angle = atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x);
    push();
    translate(centerX, centerY); 
    rotate(angle);
    image(imgBody, 0, 0, bodyWidth, bodyHeight);
    pop();
  }

  if (itemCount >= 2 && lShoulder && rShoulder) {
    let centerX = (lShoulder.x + rShoulder.x) / 2;
    let centerY = (lShoulder.y + rShoulder.y) / 2;
    let shoulderWidth = dist(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y) * 1.5;
    let angle = atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x);
    push();
    translate(centerX, centerY - 10); 
    rotate(angle);
    image(imgShoulder, 0, 0, shoulderWidth, shoulderWidth * 0.6);
    pop();
  }

  if (itemCount >= 5 && nose && lEar && rEar) {
    let headSize = dist(lEar.x, lEar.y, rEar.x, rEar.y) * 2.5; 
    let angle = atan2(rEar.y - lEar.y, rEar.x - lEar.x);       
    push();
    translate(nose.x, nose.y - 50); 
    rotate(angle);
    image(imgHelmet, 0, 0, headSize, headSize * 1.2);
    pop();
  }

  if (itemCount >= 3 && lWrist && lElbow) {
    let angle = atan2(lWrist.y - lElbow.y, lWrist.x - lElbow.x);
    let gloveH = dist(lElbow.x, lElbow.y, lWrist.x, lWrist.y) * 1.3;
    let gloveW = gloveH * 0.7; 
    push();
    translate(lWrist.x, lWrist.y);
    rotate(angle - PI/2); 
    scale(-1, 1); 
    image(imgGlove, 0, gloveH * 0.3, gloveW, gloveH);
    pop();
  }

  if (itemCount >= 6 && rElbow && rWrist) {
    let angle = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
    let swordW = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y) * 3.5;
    let swordH = swordW * 0.2; 
    push(); 
    translate(rWrist.x, rWrist.y);
    rotate(angle);
    image(imgSword, swordW * 0.35, 0, swordW, swordH); 
    pop(); 
  }

  if (itemCount >= 4 && rWrist && rElbow) {
    let angle = atan2(rWrist.y - rElbow.y, rWrist.x - rElbow.x);
    let gloveH = dist(rElbow.x, rElbow.y, rWrist.x, rWrist.y) * 1.3;
    let gloveW = gloveH * 0.7;
    push();
    translate(rWrist.x, rWrist.y);
    rotate(angle - PI/2); 
    image(imgGlove, 0, gloveH * 0.3, gloveW, gloveH);
    pop();
  }
}

function drawStatusUI() {
  fill(0, 180);
  noStroke();
  rect(10, 10, 260, 210, 10); 
  
  fill(255);
  textSize(16);
  text(`⚙️ 작동 모델: ${activeModelName}`, 20, 35); 
  
  textSize(14);
  text(`📦 확인된 물건: ${foundItems.join(', ') || '없음'}`, 20, 60); 
  text(`현재 장착 레벨: ${itemCount} / 6`, 20, 85);
  
  fill(itemCount >= 1 ? color(0, 255, 0) : 255);
  text(`[1단계] 몸통 갑옷`, 20, 110);
  fill(itemCount >= 2 ? color(0, 255, 0) : 255);
  text(`[2단계] 양쪽 견갑`, 20, 130);
  fill(itemCount >= 3 ? color(0, 255, 0) : 255);
  text(`[3단계] 왼손 장갑`, 20, 150);
  fill(itemCount >= 4 ? color(0, 255, 0) : 255);
  text(`[4단계] 오른손 장갑`, 20, 170);
  fill(itemCount >= 5 ? color(0, 255, 0) : 255);
  text(`[5단계] 헬멧`, 20, 190);
  fill(itemCount >= 6 ? color(255, 215, 0) : 255); 
  text(`[6단계] 검 (전투 준비 완료!)`, 20, 210);
}

function keyPressed() {
  if (key >= '0' && key <= '6') itemCount = parseInt(key);
}