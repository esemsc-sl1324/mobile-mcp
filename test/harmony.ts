import assert from "node:assert";

import { PNG } from "../src/png";
import { HarmonyDeviceManager, HarmonyRobot, parseHarmonyLayout } from "../src/harmony";

const manager = new HarmonyDeviceManager();
const devices = manager.getConnectedDevices();
const hasOneHarmonyDevice = devices.length >= 1;
const deviceId = devices?.[0]?.deviceId || "";
const robot = new HarmonyRobot(deviceId);

describe("harmony", () => {
	it("should parse harmony layout json", async () => {
		const sample = JSON.stringify({
			attributes: {
				bounds: "[0,0][100,100]",
				type: "Root",
				visible: "true",
				enabled: "true",
				clickable: "false",
				text: "",
			},
			children: [
				{
					attributes: {
						bounds: "[10,20][110,220]",
						type: "Text",
						visible: "true",
						enabled: "true",
						clickable: "true",
						text: "Hello",
						description: "Greeting",
						id: "hello-text",
						focused: "true",
					},
					children: [],
				},
			],
		});

		const elements = parseHarmonyLayout(sample);
		assert.equal(elements.length, 1);
		assert.equal(elements[0].type, "Text");
		assert.equal(elements[0].text, "Hello");
		assert.equal(elements[0].label, "Greeting");
		assert.equal(elements[0].identifier, "hello-text");
		assert.equal(elements[0].focused, true);
		assert.deepEqual(elements[0].rect, {
			x: 10,
			y: 20,
			width: 100,
			height: 200,
		});
	});

	it("should get harmony screenshot", async function() {
		hasOneHarmonyDevice || this.skip();

		const screenshot = await robot.getScreenshot();
		assert.ok(screenshot.length > 64 * 1024);

		const image = new PNG(screenshot);
		const size = image.getDimensions();
		assert.ok(size.width > 1000);
		assert.ok(size.height > 1000);
	});

	it("should list harmony elements on screen", async function() {
		hasOneHarmonyDevice || this.skip();

		const elements = await robot.getElementsOnScreen();
		assert.ok(elements.length > 0);

		const clickableCount = elements.filter((element) => element.label || element.text || element.identifier).length;
		assert.ok(clickableCount > 0);
	});

	it("should launch and terminate a known app", async function() {
		hasOneHarmonyDevice || this.skip();

		// Settings app exists on standard Harmony emulator images.
		await robot.launchApp("com.huawei.hmos.settings");
		await robot.terminateApp("com.huawei.hmos.settings");
	});

	it("should press HOME and BACK buttons", async function() {
		hasOneHarmonyDevice || this.skip();

		await robot.pressButton("HOME");
		await robot.pressButton("BACK");
	});
});
