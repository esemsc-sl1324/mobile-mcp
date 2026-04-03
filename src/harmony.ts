import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { ActionableError, Button, InstalledApp, Orientation, Robot, ScreenElement, ScreenSize, SwipeDirection } from "./robot";
import { PNG } from "./png";

const TIMEOUT = 30000;
const MAX_BUFFER_SIZE = 1024 * 1024 * 32;

const BUTTON_MAP: Record<Button, string | null> = {
	"BACK": "Back",
	"HOME": "Home",
	"VOLUME_UP": "24",
	"VOLUME_DOWN": "25",
	"ENTER": "66",
	"DPAD_CENTER": "23",
	"DPAD_UP": "19",
	"DPAD_DOWN": "20",
	"DPAD_LEFT": "21",
	"DPAD_RIGHT": "22",
};

export interface HarmonyDevice {
	deviceId: string;
	name: string;
	version: string;
	type: "real" | "emulator";
}

interface HarmonyLayoutNode {
	attributes?: Record<string, string>;
	children?: HarmonyLayoutNode[];
}

const trim = (value: string): string => value.replace(/\r/g, "").trim();

const shellEscape = (value: string): string => {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
};

const parseBounds = (bounds: string | undefined): { x: number; y: number; width: number; height: number } | null => {
	if (!bounds) {
		return null;
	}

	const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
	if (!match) {
		return null;
	}

	const x1 = Number(match[1]);
	const y1 = Number(match[2]);
	const x2 = Number(match[3]);
	const y2 = Number(match[4]);
	const width = Math.max(0, x2 - x1);
	const height = Math.max(0, y2 - y1);

	if (width === 0 || height === 0) {
		return null;
	}

	return { x: x1, y: y1, width, height };
};

const isTrue = (value: string | undefined): boolean => value === "true";

const toOptionalValue = (value: string | undefined): string | undefined => {
	if (!value) {
		return undefined;
	}

	const trimmed = trim(value);
	return trimmed.length > 0 ? trimmed : undefined;
};

const shouldKeepNode = (attributes: Record<string, string>): boolean => {
	const clickable = isTrue(attributes.clickable);
	const longClickable = isTrue(attributes.longClickable);
	const checkable = isTrue(attributes.checkable);
	const scrollable = isTrue(attributes.scrollable);
	const hasText = !!toOptionalValue(attributes.text) || !!toOptionalValue(attributes.originalText);
	const hasDescription = !!toOptionalValue(attributes.description);
	const hasHint = !!toOptionalValue(attributes.hint);

	return clickable || longClickable || checkable || scrollable || hasText || hasDescription || hasHint;
};

export const parseHarmonyLayout = (layoutText: string): ScreenElement[] => {
	const parsed = JSON.parse(layoutText) as HarmonyLayoutNode;
	const out: ScreenElement[] = [];

	const walk = (node: HarmonyLayoutNode): void => {
		const attributes = node.attributes || {};
		const visible = attributes.visible === undefined || isTrue(attributes.visible);
		const enabled = attributes.enabled === undefined || isTrue(attributes.enabled);

		if (visible && enabled && shouldKeepNode(attributes)) {
			const rect = parseBounds(attributes.bounds || attributes.origBounds);
			if (rect) {
				out.push({
					type: toOptionalValue(attributes.type) || "unknown",
					text: toOptionalValue(attributes.text) || toOptionalValue(attributes.originalText),
					label: toOptionalValue(attributes.description) || toOptionalValue(attributes.hint),
					identifier: toOptionalValue(attributes.id) || toOptionalValue(attributes.key) || toOptionalValue(attributes.accessibilityId),
					value: toOptionalValue(attributes.checked),
					rect,
					focused: isTrue(attributes.focused),
				});
			}
		}

		for (const child of node.children || []) {
			walk(child);
		}
	};

	walk(parsed);
	return out;
};

const getHdcPath = (): string => {
	if (process.env.HDC_PATH) {
		return process.env.HDC_PATH;
	}

	const bundled = "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc";
	if (fs.existsSync(bundled)) {
		return bundled;
	}

	return "hdc";
};

export class HarmonyDeviceManager {
	private hdcPath: string;

	public constructor() {
		this.hdcPath = getHdcPath();
	}

	private hdc(args: string[]): string {
		return execFileSync(this.hdcPath, args, {
			encoding: "utf8",
			timeout: TIMEOUT,
			maxBuffer: MAX_BUFFER_SIZE,
		}).toString();
	}

	private readModel(deviceId: string): string {
		try {
			const model = trim(this.hdc(["-t", deviceId, "shell", "param", "get", "const.product.model"]));
			return model || "Harmony Device";
		} catch (_error: unknown) {
			return "Harmony Device";
		}
	}

	private readVersion(deviceId: string): string {
		try {
			const version = trim(this.hdc(["-t", deviceId, "shell", "param", "get", "const.ohos.fullname"]));
			if (version) {
				return version;
			}
		} catch (_error: unknown) {
			// ignore and fallback below
		}

		try {
			const fallback = trim(this.hdc(["-t", deviceId, "shell", "param", "get", "const.product.software.version"]));
			return fallback || "unknown";
		} catch (_error: unknown) {
			return "unknown";
		}
	}

	public getConnectedDevices(): HarmonyDevice[] {
		let output = "";
		try {
			output = this.hdc(["list", "targets"]);
		} catch (_error: unknown) {
			return [];
		}

		const lines = output
			.split("\n")
			.map(trim)
			.filter((line) => line.length > 0 && line !== "[Empty]");

		return lines.map((deviceId) => ({
			deviceId,
			name: this.readModel(deviceId),
			version: this.readVersion(deviceId),
			type: deviceId.startsWith("127.0.0.1:") ? "emulator" : "real",
		}));
	}
}

export class HarmonyRobot implements Robot {
	private hdcPath: string;

	public constructor(private deviceId: string) {
		this.hdcPath = getHdcPath();
	}

	private hdc(args: string[]): string {
		return execFileSync(this.hdcPath, args, {
			encoding: "utf8",
			timeout: TIMEOUT,
			maxBuffer: MAX_BUFFER_SIZE,
		}).toString();
	}

	private hdcShell(command: string): string {
		return this.hdc(["-t", this.deviceId, "shell", command]);
	}

	public async getScreenSize(): Promise<ScreenSize> {
		const screenshot = await this.getScreenshot();
		const dimensions = new PNG(screenshot).getDimensions();
		return {
			width: dimensions.width,
			height: dimensions.height,
			scale: 1,
		};
	}

	public async swipe(direction: SwipeDirection): Promise<void> {
		const size = await this.getScreenSize();
		const centerX = Math.floor(size.width / 2);
		const centerY = Math.floor(size.height / 2);
		await this.swipeFromCoordinate(centerX, centerY, direction);
	}

	public async swipeFromCoordinate(x: number, y: number, direction: SwipeDirection, distance?: number): Promise<void> {
		const size = await this.getScreenSize();
		const dx = distance ?? Math.floor(size.width * 0.3);
		const dy = distance ?? Math.floor(size.height * 0.3);

		let x2 = x;
		let y2 = y;

		switch (direction) {
			case "up":
				y2 = Math.max(0, y - dy);
				break;
			case "down":
				y2 = Math.min(size.height - 1, y + dy);
				break;
			case "left":
				x2 = Math.max(0, x - dx);
				break;
			case "right":
				x2 = Math.min(size.width - 1, x + dx);
				break;
			default:
				throw new ActionableError(`Swipe direction "${direction}" is not supported`);
		}

		this.hdcShell(`uitest uiInput swipe ${x} ${y} ${x2} ${y2} 600`);
	}

	public async getScreenshot(): Promise<Buffer> {
		const remotePath = "/data/local/tmp/mobile_mcp_screen.png";
		const localPath = path.join(os.tmpdir(), `mobile_mcp_screen_${Date.now()}_${Math.floor(Math.random() * 10000)}.png`);

		try {
			this.hdcShell(`uitest screenCap -p ${remotePath}`);
			execFileSync(this.hdcPath, ["-t", this.deviceId, "file", "recv", remotePath, localPath], {
				timeout: TIMEOUT,
				maxBuffer: MAX_BUFFER_SIZE,
			});

			return fs.readFileSync(localPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ActionableError(`Failed taking Harmony screenshot: ${message}`);
		} finally {
			if (fs.existsSync(localPath)) {
				fs.unlinkSync(localPath);
			}
		}
	}

	public async listApps(): Promise<InstalledApp[]> {
		try {
			const output = this.hdcShell("bm dump -a");
			const bundleNames = output
				.split("\n")
				.map(trim)
				.filter((line) => line.startsWith("bundleName:"))
				.map((line) => trim(line.split(":")[1] || ""))
				.filter((name, index, arr) => name.length > 0 && arr.indexOf(name) === index);

			return bundleNames.map((packageName) => ({
				packageName,
				appName: packageName,
			}));
		} catch (_error: unknown) {
			return [];
		}
	}

	public async launchApp(packageName: string): Promise<void> {
		const attempts = [
			`aa start -b ${shellEscape(packageName)} -a EntryAbility`,
			`aa start -b ${shellEscape(packageName)} -a MainAbility`,
			`aa start -b ${shellEscape(packageName)}`,
		];

		let lastError: string | null = null;
		for (const command of attempts) {
			try {
				this.hdcShell(command);
				return;
			} catch (error: unknown) {
				lastError = error instanceof Error ? error.message : String(error);
			}
		}

		throw new ActionableError(`Failed launching Harmony app "${packageName}": ${lastError || "unknown error"}`);
	}

	public async terminateApp(packageName: string): Promise<void> {
		try {
			this.hdcShell(`aa force-stop ${shellEscape(packageName)}`);
		} catch (_error: unknown) {
			// Keep behavior consistent with existing robots: terminate is best-effort.
		}
	}

	public async installApp(installPath: string): Promise<void> {
		try {
			this.hdc(["-t", this.deviceId, "install", installPath]);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ActionableError(`Failed installing Harmony app from "${installPath}": ${message}`);
		}
	}

	public async uninstallApp(bundleId: string): Promise<void> {
		try {
			this.hdc(["-t", this.deviceId, "uninstall", bundleId]);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ActionableError(`Failed uninstalling Harmony app "${bundleId}": ${message}`);
		}
	}

	public async openUrl(url: string): Promise<void> {
		try {
			this.hdcShell(`aa start -U ${shellEscape(url)}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ActionableError(`Failed opening URL on Harmony device: ${message}`);
		}
	}

	public async sendKeys(text: string): Promise<void> {
		this.hdcShell(`uitest uiInput text ${shellEscape(text)}`);
	}

	public async pressButton(button: Button): Promise<void> {
		const mapped = BUTTON_MAP[button];
		if (!mapped) {
			throw new ActionableError(`Button "${button}" is not supported on Harmony`);
		}

		if (mapped === "Back" || mapped === "Home" || mapped === "Power") {
			this.hdcShell(`uitest uiInput keyEvent ${mapped}`);
			return;
		}

		this.hdcShell(`uitest uiInput keyEvent ${mapped}`);
	}

	public async tap(x: number, y: number): Promise<void> {
		this.hdcShell(`uitest uiInput click ${x} ${y}`);
	}

	public async doubleTap(x: number, y: number): Promise<void> {
		this.hdcShell(`uitest uiInput doubleClick ${x} ${y}`);
	}

	public async longPress(x: number, y: number, _duration: number): Promise<void> {
		this.hdcShell(`uitest uiInput longClick ${x} ${y}`);
	}

	public async getElementsOnScreen(): Promise<ScreenElement[]> {
		const remotePath = "/data/local/tmp/mobile_mcp_layout.json";
		const localPath = path.join(os.tmpdir(), `mobile_mcp_layout_${Date.now()}_${Math.floor(Math.random() * 10000)}.json`);

		try {
			this.hdcShell(`uitest dumpLayout -p ${remotePath}`);
			execFileSync(this.hdcPath, ["-t", this.deviceId, "file", "recv", remotePath, localPath], {
				timeout: TIMEOUT,
				maxBuffer: MAX_BUFFER_SIZE,
			});

			const layoutText = fs.readFileSync(localPath, "utf8");
			return parseHarmonyLayout(layoutText);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ActionableError(`Failed reading Harmony screen elements: ${message}`);
		} finally {
			if (fs.existsSync(localPath)) {
				fs.unlinkSync(localPath);
			}
		}
	}

	public async setOrientation(_orientation: Orientation): Promise<void> {
		throw new ActionableError("Setting orientation is not yet implemented for Harmony devices");
	}

	public async getOrientation(): Promise<Orientation> {
		const size = await this.getScreenSize();
		return size.width > size.height ? "landscape" : "portrait";
	}
}
