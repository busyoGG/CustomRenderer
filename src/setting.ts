import CustomRendererPlugin, { IRule } from "src/main";
import { App, PluginSettingTab, Setting } from "obsidian";
import { Localization } from "./localization";

interface LabelDictionary {
    [key: string]: string; // 任意字符串键，对应的值必须是字符串
}

interface LabelEntry {
    placeholder: LabelDictionary;
    name: LabelDictionary;
    desc: LabelDictionary;
}


export class CustomRenderSettingTab extends PluginSettingTab {
    plugin: CustomRendererPlugin;

    labels: Record<string, LabelEntry> = {
        title: {
            placeholder: {},
            name: {
                "zh": "替换规则",
                "en": "Replace rules"
            },
            desc: {}
        },
        reg: {
            placeholder: {
                "zh": "规则",
                "en": "rule"
            },
            name: {},
            desc: {}
        },
        delete: {
            placeholder: {},
            name: {},
            desc: {
                "zh": "删除规则",
                "en": "Delete this rule"
            }
        },
        add: {
            placeholder: {},
            name: {
                "zh": "添加规则",
                "en": "Add rule"
            },
            desc: {}
        },
        rule: {
            placeholder: {},
            name: {},
            desc: {
                "zh": "{前缀}text{后缀}，或{前缀}text，例如： //text// 或者 //text。没有后缀的情况下整行生效",
                "en": "{prefix}text{suffix},or {prefix}text,such as //text// or //text.when there is no suffix, the entire line is affected."
            }
        },
    };

    constructor(app: App, plugin: CustomRendererPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {

        const { containerEl } = this;
        containerEl.empty();
        let language = Localization.getLang();

        new Setting(containerEl).setName(this.labels.title.name[language]).setHeading().setDesc(this.labels.rule.desc[language]);

        // 添加每一条规则
        this.plugin.settings.replaceRules.forEach((rule: IRule, index: number) => {
            new Setting(containerEl)
                .addText(text => {
                    let err = false;
                    text
                        .setPlaceholder(this.labels.reg.placeholder[language])
                        .setValue(rule.pattern)
                        .onChange(value => {

                            const patterns = value.split("text");
                            if (!value.includes("text") || patterns[0] === "") {
                                text.inputEl.classList.add("setting-err");
                                err = true;
                                return; // 不保存无效的值
                            }

                            // 新增：检查前缀冲突
                            const hasPrefixConflict = this.plugin.settings.replaceRules.some(rule => {
                                const rulePatterns = rule.pattern.split("text");

                                // 当前规则无后缀 && 其他规则有相同前缀 && 其他规则有后缀
                                return !patterns[1] &&
                                    (rulePatterns[0].includes(patterns[0]) || patterns[0].includes(rulePatterns[0])) &&
                                    rulePatterns[1];
                            });

                            if (hasPrefixConflict) {
                                text.inputEl.classList.add("setting-err");
                                err = true;
                                return;
                            }

                            text.inputEl.classList.remove("setting-err");

                            this.plugin.settings.replaceRules[index].pattern = value;
                            this.plugin.saveSettings();
                        })
                        .inputEl.addEventListener("blur", () => {
                            if (err) {
                                // 恢复为原始值
                                text.setValue(this.plugin.settings.replaceRules[index].pattern);
                                text.inputEl.classList.remove("setting-err");
                            }
                        })
                })
                .addText(text => text
                    .setPlaceholder("css")
                    .setValue(rule.css)
                    .onChange(value => {
                        this.plugin.settings.replaceRules[index].css = value;
                        this.plugin.saveSettings();
                    }))
                .addToggle(btn => {
                    btn.setValue(rule.copyLine)
                        // .setDisabled(true)
                        .setTooltip(this.labels.delete.desc[language])
                        .onChange(value => {
                            this.plugin.settings.replaceRules[index].copyLine = value;
                            this.plugin.saveSettings();
                        });
                })
                .addExtraButton(btn => {
                    btn.setIcon("cross")
                        .setTooltip(this.labels.delete.desc[language])
                        .onClick(() => {
                            this.plugin.settings.replaceRules.splice(index, 1);
                            this.plugin.saveSettings();
                            this.display(); // 刷新界面
                        });
                });
        });

        // 添加新规则按钮
        new Setting(containerEl)
            .addButton(btn => {
                btn.setButtonText(this.labels.add.name[language])
                    .setCta()
                    .onClick(() => {
                        this.plugin.settings.replaceRules.push({ pattern: "", css: "", copyLine: false });
                        // this.plugin.saveSettings();
                        this.display();
                    });
            });
    }
}