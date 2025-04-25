import { Plugin } from "obsidian";
import { Prec, RangeSetBuilder, EditorState } from '@codemirror/state';
import { keymap, EditorView, Decoration, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { GenericWidget } from "./GenericWidget";
import { CustomRenderSettingTab } from "./setting";

//@ts-ignore
import { syntaxTree } from '@codemirror/language';

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

		// 初始化需要回车复制行的前缀
		this.settings.replaceRules.forEach(rule => {
			let patterns = rule.pattern.split("text");
			if (!patterns[1]) {
				this.copyLinePrefix.push(patterns[0]);
				this.openRules.push(rule);
			} else {
				this.closeRules.push(rule);
			}
		});

		let lastCursorInside: number | null = null;
		let isInside = false;

		let isMouseUp = false;

		this.registerDomEvent(document.body, "mouseup", () => {
			isMouseUp = true;
		});

		let rules = [this.openRules, this.closeRules];

		const CustomReplacePlugin = ViewPlugin.fromClass(
			class {
				decorations;
				state: EditorState;

				resetMark: boolean = false;

				constructor(view: EditorView) {
					// this.state = view.state;
					this.decorations = this.buildDecorations(view);
				}

				update(update: ViewUpdate) {
					if (this.resetMark) {
						return;
					}

					if (update.geometryChanged ||
						update.docChanged ||
						update.selectionSet && isMouseUp ||
						update.viewportChanged ||
						update.focusChanged) {

						this.state = update.state;
						this.decorations = this.buildDecorations(update.view);
						isMouseUp = false;
					}
				}

				buildDecorations(view: EditorView) {
					const builder = new RangeSetBuilder<Decoration>();

					const tree = syntaxTree(view.state);
					tree.iterate({
						enter: (node: any) => {
							// 假设我们只想装饰 "FunctionDeclaration"
							// if (node.name === "FunctionDeclaration") {
							// 	const parent = node.node.parent;
							// 	if (!parent || parent.name !== "FunctionDeclaration") {
							// 		// 只有在没有父节点是 FunctionDeclaration 时才装饰（即最上层）
							// 		builder.add(node.from, node.to, Decoration.mark({ class: "my-deco" }));
							// 	}
							// }
							console.log(node.name);
						}
					});


					// const spans = Array.from(view.dom.querySelectorAll('span'));

					// self.delayedFrames(() => {
					// 	this.resetMark = true;
					// 	for (let span of spans) {
					// 		span.setAttribute('data-resetMark', 'true');
					// 	}
					// 	this.resetMark = false;
					// }, 30)

					// console.log(spans.length);
					// const clonedSpans = spans.map(span => {
					// 	span.setAttribute('data-resetMark', 'true');
					// 	let node = span.cloneNode(true) as HTMLElement;
					// 	console.log("克隆节点", node.textContent)
					// 	return node;
					// });

					// self.delayedFrames(() => {
					// 	let reses = Array.from(view.dom.querySelectorAll('span'));
					// 	for (let res of reses) {
					// 		console.log(res.textContent, res);
					// 	}
					// }, 1)

					if (!self.isLivePreview()) return builder.finish();

					const selection = view.state.selection.main;
					const cursor = selection.head;

					let isInsideTemp = false;

					// 收集所有匹配结果并排序
					// const matches: Array<{
					// 	matchFrom: number,
					// 	matchTo: number,
					// 	contentFrom: number,
					// 	contentTo: number,
					// 	rule: IRule,
					// 	isSuffix: boolean,
					// 	index: number
					// }> = [];

					let decos = [];

					for (let { from, to } of view.visibleRanges) {
						const text = view.state.doc.sliceString(from, to);
						for (const child of rules) {
							for (const rule of child) {
								let match;
								let patterns = rule.pattern.split("text");
								let pattern = self.generateRegex(patterns[0], patterns[1]);
								const isSuffix = !!patterns[1];

								while ((match = pattern.exec(text)) !== null) {
									const matchFrom = from + match.index;
									const matchTo = matchFrom + match[0].length;
									const contentFrom = matchFrom + patterns[0].length;
									const contentTo = matchTo - (isSuffix ? patterns[1].length : 0);

									// matches.push({
									// 	matchFrom,
									// 	matchTo,
									// 	contentFrom,
									// 	contentTo,
									// 	rule,
									// 	isSuffix,
									// 	index: match.index
									// });
									const isAnyContent = contentFrom < contentTo;
									if (!isAnyContent) continue;

									const isCursorInside = cursor >= matchFrom && cursor <= matchTo;
									const isCursorLeft = cursor <= contentFrom && cursor > matchFrom;
									const isCursorRight = cursor >= contentTo && cursor < matchTo;
									const isSelection = selection.from <= matchFrom && selection.to >= matchTo;

									if (view.hasFocus && (isCursorInside || isSelection)) {

										decos.push({
											from: matchFrom,
											to: contentFrom,
											deco: Decoration.mark({
												class: "sign-mark"
											})
										});
										decos.push({
											from: matchFrom,
											to: matchTo,
											deco: Decoration.mark({
												class: rule.css,
												attributes: {
													'data-deco': "true",
												}
											})
										});

										if (isSuffix) {

											decos.push({
												from: contentTo,
												to: matchTo,
												deco: Decoration.mark({
													class: "sign-mark"
												})
											});
										}

										if (!isInside || match.index != lastCursorInside) {
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

										decos.push({
											from: matchFrom,
											to: contentFrom,
											deco: Decoration.replace({
												widget: new GenericWidget("", "span", []),
											})
										});

										decos.push({
											from: matchFrom,
											to: matchTo,
											deco: Decoration.mark({
												class: rule.css,
												attributes: {
													'data-deco': "true",
												}
											})
										})

										if (isSuffix) {

											decos.push({
												from: contentTo,
												to: matchTo,
												deco: Decoration.replace({
													widget: new GenericWidget("", "span", []),
												})
											});
										}
									}
								}
							}
						}
					}

					decos.sort((a, b) => a.from - b.from);

					for (let deco of decos) {
						builder.add(deco.from, deco.to, deco.deco);
					}

					// self.delayedFrames(() => {
					// 	this.resetMark = true;
					// 	const newSpans = Array.from(view.dom.querySelectorAll('span[data-deco="true"]'));

					// 	for (let newSpan of newSpans) {
					// 		// newSpan.removeAttribute('data-resetMark');
					// 		let parent: Element | null = newSpan;
					// 		console.log("父节点", parent)
					// 		while (parent) {
					// 			let parentNode = parent.parentElement;
					// 			if (parentNode?.hasAttribute('data-resetMark')) {
					// 				// console.log("移除节点", newSpan)
					// 				parentNode.innerHTML = parent.innerHTML;
					// 				// console.log(parentNode.innerHTML, parent.innerHTML)
					// 				break;
					// 			}
					// 			parent = parent.parentElement;
					// 		}
					// 	}

					// 	// console.log("采集节点", clonedSpans)
					// 	// for (let newSpan of newSpans) {
					// 	// 	let node = clonedSpans.shift() as HTMLElement;
					// 	// 	if (node.textContent !== newSpan.textContent) continue;

					// 	// 	// console.log("还原节点", newSpan.parentElement)
					// 	// 	// newSpan.replaceWith(node);
					// 	// 	// newSpan.parentElement?.remove();
					// 	// 	// newSpan.nextElementSibling?.nextElementSibling?.remove();
					// 	// 	// newSpan.nextElementSibling?.remove();
					// 	// 	// newSpan.previousElementSibling?.previousElementSibling?.remove();
					// 	// 	// newSpan.previousElementSibling?.remove();
					// 	// 	// newSpan.remove();
					// 	// }
					// 	this.resetMark = false;

					// }, 60);

					isInside = isInsideTemp;

					return builder.finish();
				}
			},
			{
				decorations: v => v.decorations
			}
		);

		this.registerEditorExtension(
			Prec.lowest(CustomReplacePlugin)  // 关键修改点
		);

		this.registerDomEvent(document, 'keydown', (evt) => {
			if (evt.key === 'Enter') {
				const activeEditor = this.app.workspace.activeEditor?.editor;
				if (!activeEditor) return;

				const cursor = activeEditor.getCursor();
				const line = cursor.line - 1;
				const lineContent = activeEditor.getLine(line);

				let matchedPrefix = '';
				this.copyLinePrefix.some(prefix => lineContent.startsWith(prefix) && (matchedPrefix = prefix));

				if (matchedPrefix) {
					evt.preventDefault();

					if (lineContent === matchedPrefix && lineContent.length === matchedPrefix.length) {
						activeEditor.replaceRange(
							'',
							{ line: line, ch: 0 },
							{ line: line, ch: matchedPrefix.length }
						);
					} else {
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

		this.registerMarkdownPostProcessor((el, ctx) => {
			for (const child of rules) {
				for (const rule of child) {
					const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
					let node: Text;

					let patterns = rule.pattern.split("text");
					let pattern = self.generateRegex(patterns[0], patterns[1]);

					while ((node = walker.nextNode() as Text)) {
						let nodeValue = node.nodeValue as string;
						if (pattern.test(nodeValue)) {

							const spanified = nodeValue.replace(pattern, (_match, p1) => {
								return `<span class="${rule.css}">${p1}</span>`;
							});

							const tempDiv = this.app.workspace.containerEl.createDiv();
							tempDiv.innerHTML = spanified;

							node.replaceWith(...Array.from(tempDiv.childNodes));
						}
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
			pattern = `${escapedPrefix}([^${suffix[0]}\r\n\t]*)${escapedSuffix}`;
		} else {
			pattern = `${escapedPrefix}(.*?)(\r?\n|$)`;
		}

		return new RegExp(pattern, 'g');
	}

	delayedFrames(callback: Function, delay: number = 2) {
		let frameCount = 0;
		function run() {
			// 增加帧计数
			frameCount++;

			// 如果已经过了两帧，则执行目标操作
			if (frameCount === delay) {
				callback();
			} else {
				// 否则继续请求下一帧
				requestAnimationFrame(run);
			}
		}

		// 开始请求第一帧
		requestAnimationFrame(run);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
