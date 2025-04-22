import { Plugin } from "obsidian";
import { RangeSetBuilder, EditorState } from '@codemirror/state';
import { keymap, EditorView, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { GenericWidget } from "./GenericWidget";
import { CustomRenderSettingTab } from "./setting";

export interface IRule {
	pattern: string;
	css: string;
	copyLine: boolean;
}

interface CustomRendererPluginSettings {
	replaceRules: IRule[];
}

const DEFAULT_SETTINGS: CustomRendererPluginSettings = {
	replaceRules: [
		{ pattern: "//text//", css: "color-yellow", copyLine: false },
	]
}

export default class CustomRendererPlugin extends Plugin {

	settings: CustomRendererPluginSettings;

	closeRules: IRule[] = [];
	openRules: IRule[] = [];

	copyLinePrefix: string[] = [];

	autoTimer: number;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new CustomRenderSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.init();
		});
	}

	onunload() {

	}

	init() {
		let self = this;

		//初始化需要回车复制行的前缀
		this.settings.replaceRules.forEach(rule => {
			let patterns = rule.pattern.split("text");
			if (!patterns[1]) {
				this.copyLinePrefix.push(patterns[0]);
				this.openRules.push(rule);
			} else {
				this.closeRules.push(rule);
			}
		});

		// 记录上一次在标记内的光标
		let lastCursorInside: number | null = null;
		let isInside = false;

		let isMouseUp = false;

		this.registerDomEvent(document.body, "mouseup", () => {
			isMouseUp = true;
		});

		let rules = [this.closeRules, this.openRules];

		const CustomReplacePlugin = ViewPlugin.fromClass(
			class {
				decorations;

				constructor(view: EditorView) {
					this.decorations = this.buildDecorations(view);
				}

				update(update: ViewUpdate) {

					if (update.geometryChanged ||
						update.docChanged ||
						update.selectionSet && isMouseUp ||
						update.viewportChanged ||
						update.focusChanged) {

						this.decorations = this.buildDecorations(update.view);
						isMouseUp = false;
					}
				}

				buildDecorations(view: EditorView) {
					const builder = new RangeSetBuilder<Decoration>();

					if (!self.isLivePreview()) return builder.finish();

					const selection = view.state.selection.main;
					const cursor = selection.head;

					let isInsideTemp = false;

					// 收集所有匹配结果并排序
					const matches: Array<{
						matchFrom: number,
						matchTo: number,
						contentFrom: number,
						contentTo: number,
						rule: IRule,
						isSuffix: boolean,
						index: number
					}> = [];

					for (let { from, to } of view.visibleRanges) {
						const text = view.state.doc.sliceString(from, to);
						for (const child of rules) {
							for (const rule of child) {
								let match;

								let patterns = rule.pattern.split("text");
								let pattern = self.generateRegex(patterns[0], patterns[1]);

								const isSuffix = !!patterns[1];

								while ((match = pattern.exec(text)) !== null) {
									//匹配边界
									const matchFrom = from + match.index;
									const matchTo = matchFrom + match[0].length;

									//内容边界
									const contentFrom = matchFrom + patterns[0].length;
									const contentTo = matchTo - (isSuffix ? patterns[1].length : 0);


									matches.push({
										matchFrom,
										matchTo,
										contentFrom,
										contentTo,
										rule,
										isSuffix,
										index: match.index
									});


								}
							}
						}

					}

					// 按 from 位置排序
					matches.sort((a, b) => a.matchFrom - b.matchFrom);

					for (const match of matches) {
						const { matchFrom, matchTo, contentFrom, contentTo, rule, isSuffix } = match;
						//状态判断
						const isAnyContent = contentFrom < contentTo;

						//没有内容就默认显示
						if (!isAnyContent) continue;

						const isCursorInside = cursor >= matchFrom && cursor <= matchTo; // 光标是否在匹配内容内
						const isCursorLeft = cursor <= contentFrom && cursor > matchFrom; // 光标是否在匹配内容内且在实际内容左边
						const isCursorRight = cursor >= contentTo && cursor < matchTo; // 光标是否在匹配内容内且在实际内容右边
						const isSelection = selection.from <= matchFrom && selection.to >= matchTo; // 选取是否包含匹配内容

						//当前编辑器是焦点且 光标在匹配内容内或者选取包括匹配内容 的情况下，还原分割好的 md
						//否则渲染为无 md 符号的样式
						if (view.hasFocus && (isCursorInside || isSelection)) {
							builder.add(matchFrom, contentFrom, Decoration.mark({
								class: "sign-mark"
							}));

							builder.add(matchFrom, matchTo, Decoration.mark({
								class: rule.css
							}));

							if (isSuffix) {
								builder.add(contentTo, matchTo, Decoration.mark({
									class: "sign-mark"
								}));
							}

							// console.log(match.index, lastCursorInside?.index, isInside, isInsideTemp)
							if (!isInside || match.index != lastCursorInside) {
								//移动光标到首尾
								if (isCursorLeft) {
									requestAnimationFrame(() => {
										const selection = { anchor: matchFrom, head: matchFrom };
										view.dispatch({
											selection: selection,
										});
									});
								} else if (isCursorRight) {
									requestAnimationFrame(() => {
										const selection = { anchor: matchTo, head: matchTo };
										view.dispatch({
											selection: selection,
										});
									});
								}

								lastCursorInside = match.index;
							}

							isInsideTemp = true;

						} else {
							builder.add(matchFrom, contentFrom, Decoration.replace({
								widget: new GenericWidget("", "span", []),
								inclusive: false
							}));

							builder.add(matchFrom, matchTo, Decoration.mark({
								class: rule.css
							}));

							if (isSuffix) {
								builder.add(contentTo, matchTo, Decoration.replace({
									widget: new GenericWidget("", "span", []),
									inclusive: false
								}));
							}
						}
					}

					isInside = isInsideTemp;

					return builder.finish();
				}
			},
			{
				decorations: v => v.decorations
			}
		);

		// 注册 Editor 扩展
		this.registerEditorExtension(CustomReplacePlugin);

		// 在插件的 onload() 方法中添加：
		this.registerDomEvent(document, 'keydown', (evt) => {
			if (evt.key === 'Enter') {
				// 获取当前活动编辑器
				const activeEditor = this.app.workspace.activeEditor?.editor;
				if (!activeEditor) return;

				// 获取当前行内容
				const cursor = activeEditor.getCursor();
				const line = cursor.line - 1;
				const lineContent = activeEditor.getLine(line);

				// console.log("捕获到回车键，当前行内容:", lineContent, cursor);

				let matchedPrefix = '';

				this.copyLinePrefix.some(prefix => lineContent.startsWith(prefix) && (matchedPrefix = prefix));
				console.log("匹配到的前缀:", this.copyLinePrefix, matchedPrefix, lineContent);

				if (matchedPrefix) {
					evt.preventDefault();

					console.log(lineContent === matchedPrefix && lineContent.length === matchedPrefix.length)
					if (lineContent === matchedPrefix && lineContent.length === matchedPrefix.length) {

						// 直接删除整行（模拟普通回车行为）
						activeEditor.replaceRange(
							'',
							{ line: line, ch: 0 },
							{ line: line, ch: matchedPrefix.length }
						);
						console.log("删除整行");
					}
					// 情况2：正常注释行
					else {
						activeEditor.replaceRange(
							matchedPrefix,
							{ line: line + 1, ch: 0 },
							{ line: line + 1, ch: 0 }
						);
						activeEditor.setCursor({ line: line + 1, ch: matchedPrefix.length });
					}
				}
			}
		});

	}

	isLivePreview(): boolean {
		return document.querySelector('.is-live-preview') !== null;
	}

	/**
	 * 生成正则
	 */
	generateRegex(prefix: string, suffix?: string) {
		const escape = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
		const escapedPrefix = escape(prefix);

		let pattern;
		if (suffix) {
			const escapedSuffix = escape(suffix);
			// 注意：不支持嵌套，仅匹配最简单的非后缀内容
			pattern = `${escapedPrefix}([^${suffix[0]}\r\n\t ]*)${escapedSuffix}`;
		} else {
			pattern = `${escapedPrefix}(.*?)(\r?\n|$)`;
		}

		return new RegExp(pattern, 'g');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
