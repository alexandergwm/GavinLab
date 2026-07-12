/** pap.er 风格 Unsplash 精选 & Pexels 风景 — 直接 CDN，零 API Key */

export const UNSPLASH_W = 1920;
export const PEXELS_W = 1920;

export function buildUnsplashUrl(photoId, width = UNSPLASH_W) {
  return `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=${width}&q=85`;
}

export function buildPexelsUrl(id, width = PEXELS_W) {
  return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}`;
}

/**
 * Unsplash 精选（photoId 均已实测 HTTP 200）
 * 旅游、自然、城市夜景（类似 pap.er 审美）
 */
export const UNSPLASH_CURATED = [
  { id: 'u-1506905925346', photoId: '1506905925346-21bda4d32df4', title: '阿尔卑斯山湖', description: '雪山倒映在静谧的高山湖泊中。', credit: '© Simon Berger / Unsplash' },
  { id: 'u-1469474968028', photoId: '1469474968028-56623f02e42e', title: '山谷晨雾', description: '晨光穿透云层，照亮蜿蜒山谷。', credit: '© David Marcu / Unsplash' },
  { id: 'u-1493246507139', photoId: '1493246507139-91e8fad9978e', title: '优胜美地', description: '花岗岩峭壁与瀑布。', credit: '© Luca Bravo / Unsplash' },
  { id: 'u-1441974231531', photoId: '1441974231531-c6227db76b6e', title: '森林小径', description: '阳光穿过高大乔木洒落林间。', credit: '© Sebastian Unrau / Unsplash' },
  { id: 'u-1502602898657', photoId: '1502602898657-3e91760cbb34', title: '巴黎埃菲尔铁塔', description: '塞纳河畔的经典城市地标。', credit: '© Chris Karidis / Unsplash' },
  { id: 'u-1512453979798', photoId: '1512453979798-5ea266f8880c', title: '迪拜', description: '沙漠都市的超现代天际线。', credit: '© David Rodrigo / Unsplash' },
  { id: 'u-1507525428034', photoId: '1507525428034-b723cf961d3e', title: '热带海滩', description: '白沙滩与清澈浅海的度假胜地。', credit: '© Jakob Owens / Unsplash' },
  { id: 'u-1513635269975', photoId: '1513635269975-59663e0ac1ad', title: '伦敦泰晤士河', description: '塔桥与都市天际线的经典视角。', credit: '© Adrien Olichon / Unsplash' },
  { id: 'u-1504280390367', photoId: '1504280390367-361c6d9f38f4', title: '露营星空', description: '帐篷外的银河与山峦。', credit: '© Joshua Earle / Unsplash' },
  { id: 'u-1682687220063', photoId: '1682687220063-4742bd7fd538', title: '北极光', description: '绿紫色极光在夜空中舞动。', credit: '© Jonatan Pie / Unsplash' },
  { id: 'u-1682687982501', photoId: '1682687982501-1e58ab814714', title: '吉萨金字塔', description: '古埃及金字塔在沙漠晨曦中。', credit: '© Atul Vinayak / Unsplash' },
  { id: 'u-1682687221080', photoId: '1682687221080-5cb261c645cb', title: '挪威罗弗敦', description: '渔村红色小屋与雪山倒影。', credit: '© Johny Goerend / Unsplash' },
  { id: 'u-1519681393784', photoId: '1519681393784-d120267933ba', title: '东京夜景', description: '都市天际线与车流光轨。', credit: '© Jezael Melgoza / Unsplash' },
  { id: 'u-1753724346475', photoId: '1753724346475-d7904e206410', title: '芝加哥千禧公园', description: '「云门」雕塑与城市天际线。', credit: '© Sawyer Bengtson / Unsplash' },
  { id: 'u-1751570067086', photoId: '1751570067086-7a77b88dc53b', title: '纽约曼哈顿', description: '帝国大厦与都市丛林。', credit: '© Ryan Searle / Unsplash' },
  { id: 'u-1506905925346b', photoId: '1748524530798-915716f54d00', title: '冰岛黑沙滩', description: '北大西洋巨浪拍打火山黑沙滩。', credit: '© Maja Guseva / Unsplash' },
  { id: 'u-1469474968028b', photoId: '1578909519502-1a2be705b5ff', title: '加拿大班夫', description: '碧蓝湖水与松林环绕的国家公园。', credit: '© Bobbie M / Unsplash' },
  { id: 'u-1493246507139b', photoId: '1534106474077-f9e9c6f5a47c', title: '多洛米蒂山', description: '意大利多洛米蒂的锯齿状山峰与草甸。', credit: '© Luca Bravo / Unsplash' },
  { id: 'u-1441974231531b', photoId: '1470071459604-3b5ec3a7fe05', title: '托斯卡纳丘陵', description: '起伏的橄榄树与葡萄园丘陵。', credit: '© Cedric Letsch / Unsplash' },
  { id: 'u-1502602898657b', photoId: '1505118380757-91f5f5632de0', title: '太平洋海岸', description: '夕阳将海岸线染成金橙色。', credit: '© Tim Foster / Unsplash' },
  { id: 'u-1512453979798b', photoId: '1661345441183-d3d10b1f4e97', title: '挪威峡湾', description: '深邃峡湾两岸森林与瀑布。', credit: '© Tobias Bjørkli / Unsplash' },
  { id: 'u-1507525428034b', photoId: '1639494845874-e8cffbe830fe', title: '普罗旺斯薰衣草', description: '紫色花田延伸至地平线。', credit: '© Ryan Stone / Unsplash' },
  { id: 'u-1513635269975b', photoId: '1551291420-91160f3d4961', title: '山间木屋', description: '雪线之上的孤独木屋与峰峦。', credit: '© Luca Bravo / Unsplash' },
  { id: 'u-1504280390367b', photoId: '1585799845416-27985b4ea9a9', title: '新西兰瓦纳卡', description: '瓦纳卡湖与南阿尔卑斯山。', credit: '© Geoff Byron / Unsplash' },
  { id: 'u-1682687220063b', photoId: '1531662439848-a7ed93c51468', title: '巴厘岛梯田', description: '层层水稻梯田与椰林。', credit: '© Fahri Ramdani / Unsplash' },
  { id: 'u-1682687982501b', photoId: '1747136789192-7eb98551ee00', title: '瑞士卢塞恩', description: '湖光山色中的欧洲小城。', credit: '© Austris Augusts / Unsplash' },
  { id: 'u-1682687221080b', photoId: '1474044159687-1ee9f3a51722', title: '大峡谷', description: '科罗拉多河切割出的红色峡谷。', credit: '© Luca Micheli / Unsplash' },
  { id: 'u-1519681393784b', photoId: '1432405972618-c60b0225b8f9', title: '瀑布深潭', description: '瀑布汇入碧绿水潭。', credit: '© v2osk / Unsplash' },
  { id: 'u-1753724346475b', photoId: '1566677785469-f39c50f44d8a', title: '红杉林', description: '加州红杉国家公园的巨木。', credit: '© Vlad Bagacian / Unsplash' },
  { id: 'u-1751570067086b', photoId: '1506830392367-16cbcd8b007c', title: '优胜美地半圆顶', description: '半圆顶花岗岩巨岩。', credit: '© Ryan Wilson / Unsplash' },
  { id: 'u-1506905925346c', photoId: '1570077188670-e3a8d69ac5ff', title: '圣托里尼', description: '爱琴海蓝顶白墙与日落。', credit: '© Heidi Kaden / Unsplash' },
  { id: 'u-1469474968028c', photoId: '1770099825160-c0bc28ea9ae6', title: '威尼斯水城', description: '运河与文艺复兴建筑。', credit: '© Maksim Shutov / Unsplash' },
  { id: 'u-1493246507139c', photoId: '1639519306888-419e98f8a5b6', title: '巴黎埃菲尔铁塔', description: '夜色中灯火通明的铁塔。', credit: '© Anna Hunko / Unsplash' },
  { id: 'u-1441974231531c', photoId: '1619187269972-267d2b78a423', title: '香港维港', description: '维多利亚港两岸灯火。', credit: '© Joseph Chan / Unsplash' },
  { id: 'u-1502602898657c', photoId: '1491425432462-010715fd7ed7', title: '撒哈拉沙漠', description: '金色沙丘在落日下延绵。', credit: '© Sergey Pesterev / Unsplash' },
  { id: 'u-1512453979798c', photoId: '1548780416-f23a4186ceb9', title: '马耳他蓝洞', description: '地中海悬崖与碧蓝海水。', credit: '© Exf495AtWZI / Unsplash' },
  { id: 'u-1507525428034c', photoId: '1476664498204-2675a18e89d0', title: '旧金山金门大桥', description: '雾中大桥与海湾城市轮廓。', credit: '© JOHN TOWNER / Unsplash' },
  { id: 'u-1513635269975c', photoId: '1679560850446-3978e191d7be', title: '66 号公路', description: '经典美国公路旅行风景。', credit: '© Tim Foster / Unsplash' },
  { id: 'u-1504280390367c', photoId: '1506318164473-2dfd3ede3623', title: '雾中峰林', description: '层叠山峦在薄雾中若隐若现。', credit: '© v2osk / Unsplash' },
];

/** 从壁纸 URL 反查 curated 条目（以 photoId/pexelsId 为准） */
export function lookupCuratedEntryByUrl(url, source) {
  if (!url) return null;
  const normalized = source === 'builtin' ? 'unsplash-curated' : source;
  const photoMatch = url.match(/photo-([\d]+-[a-f0-9]+)/i);
  if (photoMatch) {
    return UNSPLASH_CURATED.find((e) => e.photoId === photoMatch[1]) || null;
  }
  if (normalized === 'pexels-scenic') {
    const pexelsMatch = url.match(/photos\/(\d+)\//);
    if (pexelsMatch) {
      const id = Number(pexelsMatch[1]);
      return PEXELS_CURATED.find((e) => e.pexelsId === id) || null;
    }
  }
  return null;
}

/** Pexels 风景精选（pexelsId 均已 HEAD/GET 实测 1920px 可用） */
export const PEXELS_CURATED = [
  { id: 'p-417074', pexelsId: 417074, title: '冰岛瀑布', description: '斯科加瀑布的壮观水幕。', credit: '© Pixabay / Pexels' },
  { id: 'p-1366919', pexelsId: 1366919, title: '挪威罗弗敦', description: '渔村与雪山相映。', credit: '© Tobias Bjørkli / Pexels' },
  { id: 'p-3225517', pexelsId: 3225517, title: '马尔代夫', description: '水上屋与透澈海水。', credit: '© Asad Photo Maldives / Pexels' },
  { id: 'p-3601425', pexelsId: 3601425, title: '瑞士马特洪峰', description: '标志性的金字塔形雪峰。', credit: '© eberhard grossgasteiger / Pexels' },
  { id: 'p-2662116', pexelsId: 2662116, title: '日本富士山', description: '樱花与富士山的经典构图。', credit: '© Satoshi Hirayama / Pexels' },
  { id: 'p-1365425', pexelsId: 1365425, title: '托斯卡纳', description: '柏树大道与金色麦田。', credit: '© Tobias Bjørkli / Pexels' },
  { id: 'p-1432054', pexelsId: 1432054, title: '巴黎塞纳河', description: '河畔桥梁与古典建筑。', credit: '© Chloé Lam / Pexels' },
  { id: 'p-1179229', pexelsId: 1179229, title: '米兰大教堂', description: '哥特式尖塔与城市广场。', credit: '© NastyaSensei / Pexels' },
  { id: 'p-414612', pexelsId: 414612, title: '阿尔卑斯山', description: '雪峰与高山草甸。', credit: '© Pixabay / Pexels' },
  { id: 'p-3493772', pexelsId: 3493772, title: '希腊圣托里尼', description: '蓝顶教堂与爱琴海。', credit: '© Tomáš Malík / Pexels' },
  { id: 'p-1134166', pexelsId: 1134166, title: '京都竹林', description: '岚山竹径的宁静绿意。', credit: '© Satoshi Hirayama / Pexels' },
  { id: 'p-572897', pexelsId: 572897, title: '挪威峡湾', description: '陡峭山壁与深蓝海面。', credit: '© Tobias Bjørkli / Pexels' },
  { id: 'p-808465', pexelsId: 808465, title: '冰岛蓝湖', description: '地热温泉与火山地貌。', credit: '© Pixabay / Pexels' },
  { id: 'p-1121123', pexelsId: 1121123, title: '瑞士少女峰', description: '欧洲屋脊的冰川景观。', credit: '© eberhard grossgasteiger / Pexels' },
  { id: 'p-1287145', pexelsId: 1287145, title: '挪威极光', description: '绿光映照的峡湾小镇。', credit: '© Tobias Bjørkli / Pexels' },
  { id: 'p-1563356', pexelsId: 1563356, title: '威尼斯', description: '贡多拉与运河桥梁。', credit: '© Chloé Lam / Pexels' },
  { id: 'p-29202983', pexelsId: 29202983, title: '匈牙利多瑙河', description: '河畔田园与远山的宁静景致。', credit: '© Molnár Tamás / Pexels' },
  { id: 'p-19772227', pexelsId: 19772227, title: '海滨城市', description: '海岸线上的现代建筑群。', credit: '© Stephan Louis / Pexels' },
  { id: 'p-12985506', pexelsId: 12985506, title: '班夫佩托湖', description: '加拿大落基山碧蓝高山湖。', credit: '© Chrissy T / Pexels' },
  { id: 'p-1666021', pexelsId: 1666021, title: '阿尔卑斯湖', description: '雪山森林倒映在静谧湖面。', credit: '© Philip Ackermann / Pexels' },
  { id: 'p-2441454', pexelsId: 2441454, title: '多洛米蒂山', description: '锯齿峰峦与高山草甸。', credit: '© eberhard grossgasteiger / Pexels' },
  { id: 'p-1624496', pexelsId: 1624496, title: '挪威雪山', description: '冰川覆盖的陡峭山峰。', credit: '© Tobias Bjørkli / Pexels' },
  { id: 'p-1770318', pexelsId: 1770318, title: '冰岛黑沙滩', description: '玄武岩柱与北大西洋巨浪。', credit: '© Tomáš Malík / Pexels' },
  { id: 'p-1032650', pexelsId: 1032650, title: '新西兰瓦纳卡', description: '孤树与南阿尔卑斯山湖景。', credit: '© Peter Fazekas / Pexels' },
];
