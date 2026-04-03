const { HarmonyRobot } = require('../lib/harmony.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function center(rect) {
  return { x: Math.floor(rect.x + rect.width / 2), y: Math.floor(rect.y + rect.height / 2) };
}

(async () => {
  const robot = new HarmonyRobot('127.0.0.1:5555');

  await robot.launchApp('com.hexin.hmn.ifund');
  await wait(3000);

  // Tap the Fund Ranking tile area on home screen.
  await robot.tap(407, 898);
  await wait(3500);

  // Tap the 3rd fund row in ranking list.
  await robot.tap(420, 1768);
  await wait(4000);

  let elements = await robot.getElementsOnScreen();
  const controls = elements
    .filter((e) => e.text || e.label || e.identifier)
    .map((e) => ({ text: e.text, label: e.label, id: e.identifier, rect: e.rect, type: e.type }));

  const starTextPattern = /自选|加自选|已自选|关注|收藏|星/;
  const starByText = controls.find((e) =>
    (typeof e.text === 'string' && starTextPattern.test(e.text)) ||
    (typeof e.label === 'string' && starTextPattern.test(e.label))
  );

  let starTarget = starByText;

  // Fallback: top-right icon candidate usually used for favorite on detail page.
  if (!starTarget) {
    const topRightCandidates = controls
      .filter((e) => e.rect && e.rect.y < 320 && e.rect.x > 980)
      .sort((a, b) => (a.rect.y - b.rect.y) || (b.rect.x - a.rect.x));
    starTarget = topRightCandidates[0];
  }

  if (!starTarget) {
    console.log(JSON.stringify({ ok: false, reason: 'star control not found', sample: controls.slice(0, 80) }, null, 2));
    process.exit(2);
  }

  const taps = [];
  const tapStarTarget = async (target) => {
    const point = center(target.rect);
    await robot.tap(point.x, point.y);
    taps.push(point);
    await wait(1400);
  };

  // Ensure final state is selected (button text "删自选").
  if (typeof starTarget.text === 'string' && starTarget.text.includes('加自选')) {
    await tapStarTarget(starTarget);
  } else if (typeof starTarget.text === 'string' && starTarget.text.includes('删自选')) {
    await tapStarTarget(starTarget);
    elements = await robot.getElementsOnScreen();
    const addTarget = elements.find((e) => typeof e.text === 'string' && e.text.includes('加自选'));
    if (addTarget) {
      await tapStarTarget(addTarget);
    }
  } else {
    await tapStarTarget(starTarget);
  }

  const verify = await robot.getElementsOnScreen();
  const verifyMatches = verify
    .filter((e) =>
      (typeof e.text === 'string' && /加自选|删自选|已自选|取消自选|自选/.test(e.text)) ||
      (typeof e.label === 'string' && /加自选|删自选|已自选|取消自选|自选/.test(e.label))
    )
    .map((e) => ({ text: e.text, label: e.label, id: e.identifier, rect: e.rect, type: e.type }));

  const finalStateSelected = verifyMatches.some((e) => typeof e.text === 'string' && e.text.includes('删自选'));

  console.log(JSON.stringify({
    ok: true,
    starTappedAt: taps,
    starMatchedByText: !!starByText,
    starTarget,
    finalStateSelected,
    verifyMatches,
  }, null, 2));
})();
