.PHONY: help install install-if-needed start dev desktop test test-watch build desktop-build prepare-mermaid ai-e2e ai-e2e-preflight ai-e2e-auto ai-e2e-mock release-updater-config release-check release-artifacts release-downloads release-install-smoke release-install-manual release-signing release-aggregate-evidence release-workflow-validate release-ci-preflight release-remote-status release-metadata release-distribution release-secrets release-secrets-sync release-readiness release-handoff release-closure release-final-audit release-tracking release-submit-prep release-submission-safety release-submission-plan release-submission-manifest release-submission-preview release-push-readiness release-dry-run release-verify release-local preview clean

ifeq ($(OS),Windows_NT)
DESKTOP_DEV_CMD := npm run desktop:dev
DESKTOP_BUILD_CMD := npm run desktop:build
else
TAURI_RUST_ENV := RUSTC="$$(rustup which --toolchain stable rustc 2>/dev/null || command -v rustc)" RUSTDOC="$$(rustup which --toolchain stable rustdoc 2>/dev/null || command -v rustdoc)"
DESKTOP_DEV_CMD := $(TAURI_RUST_ENV) npm run tauri:dev
DESKTOP_BUILD_CMD := $(TAURI_RUST_ENV) npm run tauri:build
endif

help:
	@printf "\nMoKnow 常用命令\n"
	@printf "================\n"
	@printf "  make start        一键安装依赖并启动前端预览\n"
	@printf "  make dev          启动前端预览，等同于 npm run dev\n"
	@printf "  make desktop      启动 Tauri 桌面应用\n"
	@printf "  make install      安装 npm 依赖\n"
	@printf "  make test         运行测试\n"
	@printf "  make test-watch   监听模式运行测试\n"
	@printf "  make prepare-mermaid 准备 Mermaid 按需运行时资源\n"
	@printf "  make build        构建前端产物\n"
	@printf "  make desktop-build 构建 Tauri 桌面应用\n"
	@printf "  make ai-e2e       运行真实外部 AI Provider 端到端联调\n"
	@printf "  make ai-e2e-preflight 检查真实外部 AI 联调前置条件\n"
	@printf "  make ai-e2e-auto  自动探测环境变量、Ollama 或 LM Studio 并尝试真实 AI 联调\n"
	@printf "  make ai-e2e-mock  运行本地 OpenAI-compatible AI 联调自测\n"
	@printf "  make release-updater-config 生成 Tauri updater 临时配置\n"
	@printf "  make release-check 发布前静态检查\n"
	@printf "  make release-artifacts 检查本机发布产物\n"
	@printf "  make release-downloads 验证下载后的发布 artifacts 完整性\n"
	@printf "  make release-install-smoke 验证安装包入口和实机打开清单\n"
	@printf "  make release-install-manual 记录人工安装打开读写验收结果\n"
	@printf "  make release-signing 验证签名、公证和 Gatekeeper / Authenticode 状态\n"
	@printf "  make release-aggregate-evidence 聚合三平台 artifacts 中的安装与签名报告\n"
	@printf "  make release-workflow-validate 结构化验证 Release workflow YAML\n"
	@printf "  make release-ci-preflight 检查远端 Release Dry Run 前置条件\n"
	@printf "  make release-remote-status 读取远端 workflow、run、artifacts 和 Release 状态\n"
	@printf "  make release-metadata 生成 latest.json、下载清单和 Homebrew cask\n"
	@printf "  make release-distribution 验证下载 URL、updater endpoint、Homebrew / 官网分发配置\n"
	@printf "  make release-secrets 审计 GitHub Actions secrets 名称是否已配置\n"
	@printf "  make release-secrets-sync 预览或同步本机环境变量到 GitHub Actions secrets\n"
	@printf "  make release-readiness 生成外部发布配置清单\n"
	@printf "  make release-handoff 生成外部闭环交接清单和环境变量模板\n"
	@printf "  make release-closure 运行项目进度外部闭环总门禁并生成记录\n"
	@printf "  make release-final-audit 汇总项目进度未完成项的自动证据审计\n"
	@printf "  make release-tracking 检查发布闭环文件是否入库\n"
	@printf "  make release-submit-prep 一键运行发布闭环提交前非破坏性准备检查\n"
	@printf "  make release-submission-safety 扫描发布闭环提交清单中的密钥和生成产物风险\n"
	@printf "  make release-submission-plan 生成发布闭环文件提交入库计划\n"
	@printf "  make release-submission-manifest 生成发布闭环提交文件 SHA-256 校验清单\n"
	@printf "  make release-submission-preview 使用临时 index 预演发布闭环提交内容\n"
	@printf "  make release-push-readiness 检查发布闭环文件推送远端前置条件\n"
	@printf "  make release-dry-run 触发远端 Release Dry Run 并下载验证 artifacts\n"
	@printf "  make release-verify 发布前测试和前端构建验证\n"
	@printf "  make release-local 发布前测试、前端构建和本机桌面构建验证\n"
	@printf "  make preview      预览前端构建产物\n"
	@printf "  make clean        清理前端构建产物\n"
	@printf "\n推荐首次启动：make start\n\n"

install:
	npm install

install-if-needed:
	@if [ ! -d node_modules ]; then \
		printf "未检测到 node_modules，正在安装依赖...\n"; \
		npm install; \
	else \
		printf "已检测到 node_modules，跳过依赖安装。\n"; \
	fi

start: install-if-needed
	npm run dev

dev:
	npm run dev

desktop: install-if-needed
	$(DESKTOP_DEV_CMD)

test:
	npm run test

test-watch:
	npm run test:watch

prepare-mermaid:
	npm run prepare:mermaid

build:
	npm run build

desktop-build: install-if-needed
	$(DESKTOP_BUILD_CMD)

ai-e2e:
	npm run ai:e2e

ai-e2e-preflight:
	npm run ai:e2e:preflight

ai-e2e-auto:
	npm run ai:e2e:auto

ai-e2e-mock:
	npm run ai:e2e:mock

release-updater-config:
	npm run release:updater-config

release-check:
	npm run release:check

release-artifacts:
	npm run release:artifacts

release-downloads:
	npm run release:downloads

release-install-smoke:
	npm run release:install-smoke

release-install-manual:
	npm run release:install-manual

release-signing:
	npm run release:signing

release-aggregate-evidence:
	npm run release:aggregate-evidence

release-workflow-validate:
	npm run release:workflow-validate

release-ci-preflight:
	npm run release:ci-preflight

release-remote-status:
	npm run release:remote-status

release-metadata:
	npm run release:metadata

release-distribution:
	npm run release:distribution

release-secrets:
	npm run release:secrets

release-secrets-sync:
	npm run release:secrets:sync

release-readiness:
	npm run release:readiness

release-handoff:
	npm run release:handoff

release-closure:
	npm run release:closure

release-final-audit:
	npm run release:final-audit

release-tracking:
	npm run release:tracking

release-submit-prep:
	npm run release:submit-prep

release-submission-safety:
	npm run release:submission-safety

release-submission-plan:
	npm run release:submission-plan

release-submission-manifest:
	npm run release:submission-manifest

release-submission-preview:
	npm run release:submission-preview

release-push-readiness:
	npm run release:push-readiness

release-dry-run:
	npm run release:dry-run

release-verify:
	npm run release:verify

release-local: install-if-needed
	npm run release:local

preview:
	npm run preview

clean:
	rm -rf dist public/vendor/mermaid release src-tauri/tauri.updater.conf.json
