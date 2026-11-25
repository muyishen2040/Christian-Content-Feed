const stories = [
  { title: '在新的地方，重新找到盼望', topic: '新的開始', summary: '搬到陌生的城市後，她在看似平凡的相遇裡，慢慢找到新的歸屬。', image: 'story-1.jpg', paragraphs: ['剛到這座城市的時候，我常常在下班後一個人走回家。街道很熱鬧，心裡卻有種說不出的安靜。', '後來，一位新認識的朋友邀請我一起吃飯。那天沒有什麼特別的安排，只有一頓簡單的晚餐，和願意聽我說話的人。', '日子沒有突然變得容易，但我開始相信，即使在不熟悉的地方，也能一步一步找到陪伴。'] },
  { title: '等待中的小小亮光', topic: '信心與等待', summary: '當生活不如預期，一段關於耐心、信心與陪伴的旅程。', image: 'story-2.jpg', paragraphs: ['那段等待的日子，比我想像中還長。每天醒來，我都期待事情能有一點不同，卻總是看不到答案。', '朋友提醒我，不必急著把每一天都過成一個結果。有時候，願意好好吃飯、走一段路，就是今天的進步。', '回頭看，改變是慢慢發生的。那些陪伴我的人，讓我在等待中仍然看見一點亮光。'] },
  { title: '學習把重擔放下', topic: '平安', summary: '在忙碌和不安之間，他重新學習如何停下腳步，聆聽自己的心。', image: 'story-3.jpg', paragraphs: ['我曾經以為，只有不斷往前走，才能證明自己做得夠好。日子排得很滿，心卻越來越疲憊。', '一次談話中，朋友問我：「如果今天可以不用解決所有事，你想為自己留下一點什麼？」', '我開始試著在每天早晨留一段安靜的時間。事情沒有全部消失，但我不再需要一個人承擔每一件事。'] },
  { title: '那些有人同行的日子', topic: '陪伴', summary: '從一次簡單的問候開始，她發現生活中的溫柔常常來自彼此陪伴。', image: 'story-4.jpg', paragraphs: ['有一段時間，我不太知道該怎麼向別人說出自己的感受，總覺得不想麻煩任何人。', '一位朋友沒有催促我，只是偶爾傳來訊息，問我今天過得怎麼樣。慢慢地，我開始願意說出心裡的事。', '我才明白，陪伴不一定是給出答案，有時只是有人願意坐下來，一起走過那一段路。'] },
];

const $ = (id) => document.getElementById(id);
const card = $('storyCard');
const state = { index: 0, saved: new Set(), selected: null, busy: false };
let drag = null;
let suppressClick = false;

function render() {
  const story = stories[state.index];
  const done = !story;
  card.hidden = done;
  $('endCard').hidden = !done;
  document.querySelectorAll('.stack-card').forEach((item) => { item.hidden = done; });
  if (done) return;
  $('cover').style.backgroundImage = `url('${story.image}')`;
  const following = stories[state.index + 1];
  const afterFollowing = stories[state.index + 2];
  document.querySelector('.stack-middle').hidden = !following;
  document.querySelector('.stack-back').hidden = !afterFollowing;
  if (following) document.querySelector('.stack-middle .stack-art').style.backgroundImage = `url('${following.image}')`;
  if (afterFollowing) document.querySelector('.stack-back .stack-art').style.backgroundImage = `url('${afterFollowing.image}')`;
  $('topic').textContent = story.topic;
  $('cardTitle').textContent = story.title;
  $('cardSummary').textContent = story.summary;
  card.setAttribute('aria-label', `閱讀故事：${story.title}`);
}

function announce(message) { $('announce').textContent = message; }

function decide(action) {
  if (state.busy || state.index >= stories.length) return;
  state.busy = true;
  const index = state.index;
  if (action === 'save') state.saved.add(index);
  card.style.transform = '';
  card.classList.add(action === 'save' ? 'exit-right' : 'exit-left');
  announce(action === 'save' ? '已收藏故事' : '已略過故事');
  window.setTimeout(() => {
    state.index += 1;
    state.busy = false;
    card.classList.remove('exit-right', 'exit-left');
    document.querySelector('.stamp-save').style.opacity = '0';
    document.querySelector('.stamp-pass').style.opacity = '0';
    render();
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
}

function openStory(index) {
  const story = stories[index];
  if (!story || state.busy) return;
  state.selected = index;
  $('readingTopic').textContent = story.topic;
  $('readingTitle').textContent = story.title;
  $('readingLead').textContent = story.summary;
  $('readingText').replaceChildren(...story.paragraphs.map((text) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    return paragraph;
  }));
  $('saveFromReading').querySelector('span').textContent = state.saved.has(index) ? '已收藏' : '收藏這篇';
  $('saveFromReading').disabled = state.saved.has(index);
  if ($('savedDialog').open) $('savedDialog').close();
  $('readDialog').showModal();
}

function showSaved() {
  const list = $('savedList');
  list.replaceChildren();
  if (!state.saved.size) {
    const empty = document.createElement('p');
    empty.className = 'saved-empty';
    empty.textContent = '還沒有收藏的故事。右滑卡片，或按下收藏，就能留在這裡。';
    list.append(empty);
  } else {
    [...state.saved].forEach((index) => {
      const story = stories[index];
      const button = document.createElement('button');
      button.className = 'saved-row';
      button.type = 'button';
      const picture = document.createElement('img');
      picture.src = story.image;
      picture.alt = '';
      const text = document.createElement('span');
      text.className = 'saved-row-text';
      const topic = document.createElement('small');
      topic.textContent = story.topic;
      const title = document.createElement('strong');
      title.textContent = story.title;
      text.append(topic, title);
      button.append(picture, text);
      button.addEventListener('click', () => openStory(index));
      list.append(button);
    });
  }
  $('savedDialog').showModal();
}

card.addEventListener('pointerdown', (event) => {
  if (state.busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
  drag = { x: event.clientX, y: event.clientY, distance: 0, vertical: false };
  card.setPointerCapture(event.pointerId);
  card.classList.add('dragging');
});
card.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) drag.vertical = true;
  if (drag.vertical) return;
  drag.distance = dx;
  card.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
  document.querySelector('.stamp-save').style.opacity = String(Math.min(1, Math.max(0, dx / 90)));
  document.querySelector('.stamp-pass').style.opacity = String(Math.min(1, Math.max(0, -dx / 90)));
});
function finishDrag() {
  if (!drag) return;
  const { distance, vertical } = drag;
  suppressClick = Math.abs(distance) > 8 || vertical;
  card.classList.remove('dragging');
  drag = null;
  if (!vertical && Math.abs(distance) >= 70) decide(distance > 0 ? 'save' : 'pass');
  else {
    card.style.transform = '';
    document.querySelector('.stamp-save').style.opacity = '0';
    document.querySelector('.stamp-pass').style.opacity = '0';
  }
}
card.addEventListener('pointerup', finishDrag);
card.addEventListener('pointercancel', finishDrag);
card.addEventListener('click', () => {
  if (suppressClick) { suppressClick = false; return; }
  openStory(state.index);
});
card.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openStory(state.index); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); decide('pass'); }
  if (event.key === 'ArrowRight') { event.preventDefault(); decide('save'); }
});
$('savedAtEnd').addEventListener('click', showSaved);
$('closeReading').addEventListener('click', () => $('readDialog').close());
$('closeReadFooter').addEventListener('click', () => $('readDialog').close());
$('closeSaved').addEventListener('click', () => $('savedDialog').close());
$('saveFromReading').addEventListener('click', () => {
  state.saved.add(state.selected);
  $('saveFromReading').querySelector('span').textContent = '已收藏';
  $('saveFromReading').disabled = true;
  render();
  announce('已收藏故事');
});
$('restartButton').addEventListener('click', () => { state.index = 0; render(); });
render();
