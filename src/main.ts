import { Plugin } from "obsidian";
import { RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { GenericWidget } from "./GenericWidget";
import { CustomRenderSettingTab } from "./setting";

export interface IRule {
	pattern: string;
	css: string
}

interface CustomRendererPluginSettings {
	replaceRules: IRule[];
}

const DEFAULT_SETTINGS: CustomRendererPluginSettings = {
	replaceRules: [
		{ pattern: "//text//", css: "color-yellow" }
	]
}

export default class CustomRendererPlugin extends Plugin {

	settings: CustomRendererPluginSettings;

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

		// 记录上一次在标记内的光标
		let lastCursorInside: RegExpExecArray | null = null;
		let isMouseUp = false;

		this.registerDomEvent(document.body, "mouseup", () => {
			isMouseUp = true;
		});

		const CustomReplacePlugin = ViewPlugin.fromClass(
			class {
				decorations;

				constructor(view: EditorView) {
					this.decorations = this.buildDecorations(view);
				}

				update(update: ViewUpdate) {
					if (update.docChanged || update.selectionSet && isMouseUp || update.viewportChanged || update.focusChanged) {
						this.decorations = this.buildDecorations(update.view);
						isMouseUp = false;
					}
				}

				buildDecorations(view: EditorView) {
					const builder = new RangeSetBuilder<Decoration>();
					const selection = view.state.selection.main;
					const cursor = selection.head;

					for (let { from, to } of view.visibleRanges) {
						const text = view.state.doc.sliceString(from, to);
						for (const rule of self.settings.replaceRules) {
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

								//状态判断
								const isCursorInside = cursor >= matchFrom && cursor <= matchTo; // 光标是否在匹配内容内
								const isCursorLeft = cursor <= contentFrom && cursor > matchFrom; // 光标是否在匹配内容内且在实际内容左边
								const isCursorRight = cursor >= contentTo && cursor < matchTo; // 光标是否在匹配内容内且在实际内容右边
								const isSelection = selection.from <= matchFrom && selection.to >= matchTo; // 选取是否包含匹配内容

								//当前编辑器是焦点且 光标在匹配内容内或者选取包括匹配内容 的情况下，还原分割好的 md
								//否则渲染为无 md 符号的样式
								if (view.hasFocus && (isCursorInside || isSelection)) {
									builder.add(matchFrom, contentFrom, Decoration.mark({
										class: "single-mark"
									}));

									builder.add(contentFrom, contentTo, Decoration.mark({
										class: rule.css
									}));

									if (isSuffix) {
										builder.add(contentTo, matchTo, Decoration.mark({
											class: "single-mark"
										}));
									}

									if (match.index != lastCursorInside?.index) {
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

										lastCursorInside = match;
									}

								} else {
									builder.add(matchFrom, contentFrom, Decoration.replace({
										widget: new GenericWidget("", "span", []),
										inclusive: false
									}));

									builder.add(contentFrom, contentTo, Decoration.mark({
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
						}
					}

					return builder.finish();
				}
			},
			{
				decorations: v => v.decorations
			}
		);

		// 注册 Editor 扩展
		this.registerEditorExtension(CustomReplacePlugin);
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
			pattern = `${escapedPrefix}([^${suffix[0]}]*)${escapedSuffix}`;
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
