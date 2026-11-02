#!/usr/bin/env node
/**
 * 线上凭证探针（部署后兜底，凭证门约定第三道；细则 references/deploy-gate.md 凭证门约定节）。
 * 用法: node scripts/harness/credential-probe.mjs --base-url <线上入口URL>
 *       --base-url 必填（线上入口属项目侧事实，不进模板缺省；自签证书场景由 curl -sk 放行）。
 * 逻辑: GET / 收集 /assets/*.js → 逐个收集二级 chunk 引用 → 对 deploy/frontend-credentials.json
 *       每键取 envPath（缺省 frontend/.env）值:优先含 chunkHint 的 chunk 找值字面量,无命名 chunk 降级
 *       全量扫(注记),仍无→红。清单不在=ℓ 跳过 exit 0（非前端项目零负担，禁静默降级）。
 * 铁律:凭证值绝不进任何输出/日志——失败只报键名+chunk 名。
 * 接线义务:本探针由 mech install DEPLOY_GATE 渲染入项目；不接进 project.json deploy.commands /
 *       webCommands（ping 之后）=纯死文件——接线是项目自己的部署链义务。
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const baseArg = args.indexOf('--base-url')
if (baseArg < 0 || !args[baseArg + 1]) {
  console.error('用法: node scripts/harness/credential-probe.mjs --base-url <线上入口URL>（必填——线上入口属项目侧事实）')
  process.exit(1)
}
const BASE = args[baseArg + 1].replace(/\/+$/, '')
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function get(urlPath) {
  // curl -sk:自签证书放行;--max-time 防悬挂;输出只在本进程内存参与断言
  return execFileSync('curl', ['-sk', '--max-time', '20', BASE + urlPath], { maxBuffer: 64 * 1024 * 1024 }).toString()
}

const manifestPath = path.join(REPO_ROOT, 'deploy', 'frontend-credentials.json')
if (!fs.existsSync(manifestPath)) {
  console.log('ℓ 凭证探针: 项目未配置凭证清单(deploy/frontend-credentials.json)——跳过（前端项目按 deploy-gate.md 凭证门约定节登记）')
  process.exit(0)
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const envPath = manifest.envPath || 'frontend/.env'
const env = new Map()
for (const line of fs.readFileSync(path.join(REPO_ROOT, envPath), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
  if (m !== null) env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''))
}

const allChunks = new Set()
const html = get('/')
for (const m of html.matchAll(/(\/assets\/[A-Za-z0-9_.-]+\.js)/g)) allChunks.add(m[1])
for (const u of [...allChunks]) {
  for (const m of get(u).matchAll(/\/?assets\/[A-Za-z0-9_.-]+\.js/g)) {
    allChunks.add(m[0].startsWith('/') ? m[0] : `/${m[0]}`)
  }
}
if (allChunks.size === 0) {
  console.error(`✗ 线上凭证探针:未解析到任何 chunk(构建结构变化,修探针) base=${BASE}`)
  process.exit(1)
}

const missing = []
for (const { name, chunkHint } of manifest.keys) {
  const value = env.get(name) ?? ''
  if (value === '') {
    missing.push(`${name}(本地 .env 缺值,先补 ${envPath})`)
    continue
  }
  let targets = [...allChunks].filter((u) => u.includes(chunkHint))
  let degraded = false
  if (targets.length === 0) {
    degraded = true
    targets = [...allChunks]
  }
  const hit = targets.some((u) => get(u).includes(value))
  if (!hit) missing.push(`${name} 未命中${degraded ? '(降级全量扫描后仍缺)' : `${chunkHint} chunk`}`)
  if (degraded) console.log(`  注记:${name} 命名 chunk 未找到,已降级全量扫描`)
}

if (missing.length > 0) {
  console.error(`✗ 线上凭证探针:凭证值缺失 → ${missing.join('; ')}(对照历史空包事故同型)`)
  process.exit(1)
}
console.log(`✓ 线上凭证探针:${manifest.keys.length} 键在位`)
