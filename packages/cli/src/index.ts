import assert from 'node:assert';
import { writeFileSync } from 'node:fs';
import { PuppeteerAgent } from '@midscene/web';
import ora from 'ora-classic';
import puppeteer from 'puppeteer';
import { type ArgumentValueType, findOnlyItemInArgs, parse } from './args';

let spinner: ora.Ora | undefined;
const stepString = (name: string, param?: any) => {
  let paramStr;
  if (typeof param === 'object') {
    paramStr = JSON.stringify(param, null, 2);
  } else if (name === 'sleep') {
    paramStr = `${param}ms`;
  } else {
    paramStr = param;
  }
  return `${name}\n  ${paramStr ? `${paramStr}` : ''}`;
};

const printStep = (name: string, param?: any) => {
  if (spinner) {
    spinner.stop();
  }
  console.log(`- ${stepString(name, param)}`);
};

const updateSpin = (text: string) => {
  if (!spinner) {
    spinner = ora(text);
    spinner.start();
  } else {
    spinner.text = text;
    spinner.start();
  }
};

const preferenceArgs = {
  url: 'url',
  headed: 'headed',
  viewportWidth: 'viewport-width',
  viewportHeight: 'viewport-height',
  viewportScale: 'viewport-scale',
  useragent: 'user-agent',
  // preferCache: 'prefer-cache',
  // cookie: 'cookie',
};

const actionArgs = {
  action: 'action',
  assert: 'assert',
  queryOutput: 'query-output',
  query: 'query',
  sleep: 'sleep',
};

const defaultUA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const welcome = '\nWelcome to @midscene/cli\n';
console.log(welcome);

const args = parse(process.argv);

if (findOnlyItemInArgs(args, 'help')) {
  console.log(`
  Usage: midscene [options] [actions]

  Options:
    --url <url>                 The URL to visit, required
    --user-agent <ua>           The user agent to use, optional
    --viewport-width <width>    The width of the viewport, optional
    --viewport-height <height>  The height of the viewport, optional
    --viewport-scale <scale>    The device scale factor, optional
    --headed                    Run in headed mode, default false
    --help                      Display this help message
    --version                   Display the version

  Actions (the order matters, can be used multiple times):
    --action <action>           Perform an action, optional
    --assert <assert>           Perform an assert, optional
    --query-output <path>       Save the result of the query to a file, this must be put before --query, optional
    --query <query>             Perform a query, optional
    --sleep <ms>                Sleep for a number of milliseconds, optional

  Examples:
    # headed mode (i.e. visible browser) to visit bing.com and search for 'weather today'
    midscene --headed --url https://wwww.bing.com --action "type 'weather today' in search box, hit enter" --sleep 3000

    # visit github status page and save the status to ./status.json
    midscene --url https://www.githubstatus.com/ \\
      --query-output status.json \\
      --query '{name: string, status: string}[], service status of github page'

  Examples with Chinese Prompts
    # headed 模式（即可见浏览器）访问 baidu.com 并搜索“天气”
    midscene --headed --url https://www.baidu.com --action "在搜索框输入 '天气', 敲回车" --sleep 3000

    # 访问 Github 状态页面并将状态保存到 ./status.json
    midscene --url https://www.githubstatus.com/ \\
      --query-output status.json \\
      --query '{serviceName: string, status: string}[], github 页面的服务状态，返回服务名称'
  `);
  process.exit(0);
}

if (findOnlyItemInArgs(args, 'version')) {
  const versionFromPkgJson = require('../package.json').version;
  console.log(`@midscene/cli version ${versionFromPkgJson}`);
  process.exit(0);
}

// check each arg is either in the preferenceArgs or actionArgs
args.forEach((arg) => {
  assert(
    Object.values(preferenceArgs).includes(arg.name) ||
      Object.values(actionArgs).includes(arg.name),
    `Unknown argument: ${arg.name}`,
  );
});

// prepare the viewport config
const preferHeaded = findOnlyItemInArgs(args, preferenceArgs.headed);
const userExpectWidth = findOnlyItemInArgs(args, preferenceArgs.viewportWidth);
const userExpectHeight = findOnlyItemInArgs(
  args,
  preferenceArgs.viewportHeight,
);
const userExpectDpr = findOnlyItemInArgs(args, preferenceArgs.viewportScale);
const viewportConfig = {
  width: typeof userExpectWidth === 'number' ? userExpectWidth : 1280,
  height: typeof userExpectHeight === 'number' ? userExpectHeight : 1280,
  deviceScaleFactor: typeof userExpectDpr === 'number' ? userExpectDpr : 1,
};
const url = findOnlyItemInArgs(args, preferenceArgs.url);
assert(url, 'URL is required');
assert(typeof url === 'string', 'URL must be a string');

const preferredUA = findOnlyItemInArgs(args, preferenceArgs.useragent);
const ua = typeof preferredUA === 'string' ? preferredUA : defaultUA;

printStep(preferenceArgs.url, url);
printStep(preferenceArgs.useragent, ua);
printStep('viewport', JSON.stringify(viewportConfig));
if (preferHeaded) {
  printStep(preferenceArgs.headed, 'true');
}

Promise.resolve(
  (async () => {
    updateSpin(stepString('launch', 'puppeteer'));
    const browser = await puppeteer.launch({
      headless: !preferHeaded,
    });

    const page = await browser.newPage();
    await page.setUserAgent(ua);

    await page.setViewport(viewportConfig);

    updateSpin(stepString('launch', url));
    await page.goto(url);
    updateSpin(stepString('waitForNetworkIdle', url));
    await page.waitForNetworkIdle();
    printStep('launched', url);

    const agent = new PuppeteerAgent(page);

    let errorWhenRunning: Error | undefined;
    let argName: string;
    let argValue: ArgumentValueType;
    try {
      let index = 0;
      let outputPath: string | undefined;
      let actionStarted = false;
      while (index <= args.length - 1) {
        const arg = args[index];
        argName = arg.name;
        argValue = arg.value;
        updateSpin(stepString(argName, String(argValue)));
        const validActionArg = Object.values(actionArgs).includes(argName);
        // once action started, you cannot use preferenceArgs
        if (actionStarted) {
          assert(
            validActionArg,
            `You cannot put --${argName} here. Please change the order of the arguments.`,
          );
        }
        if (validActionArg) {
          actionStarted = true;
        }
        switch (argName) {
          case actionArgs.action: {
            const param = arg.value;
            assert(param, 'missing action');
            assert(typeof param === 'string', 'action must be a string');
            await agent.aiAction(param);
            printStep(argName, String(argValue));
            break;
          }
          case actionArgs.assert: {
            const param = arg.value;
            assert(param, 'missing assert');
            assert(typeof param === 'string', 'assert must be a string');
            await agent.aiAssert(param);
            printStep(argName, String(argValue));
            break;
          }
          case actionArgs.queryOutput: {
            const param = arg.value;
            assert(param, 'missing query-output');
            assert(typeof param === 'string', 'query-output must be a string');
            outputPath = param;
            printStep(argName, String(argValue));
            break;
          }
          case actionArgs.query: {
            const param = arg.value;
            assert(param, 'missing query');
            assert(typeof param === 'string', 'query must be a string');
            const value = await agent.aiQuery(param);
            printStep(argName, String(argValue));
            printStep('answer', value);
            if (outputPath) {
              writeFileSync(
                outputPath,
                typeof value === 'object'
                  ? JSON.stringify(value, null, 2)
                  : value,
              );
            }
            break;
          }
          case actionArgs.sleep: {
            const param = arg.value;
            if (!param) break;
            assert(typeof param === 'number', 'sleep must be a number');
            await new Promise((resolve) => setTimeout(resolve, param));
            printStep(argName, String(argValue));
            break;
          }
        }
        index += 1;
      }
    } catch (e: any) {
      printStep(`${argName!} - Failed`, String(argValue!));
      printStep('Error', e.message);
      errorWhenRunning = e;
    }

    await browser.close();
    process.exit(errorWhenRunning ? 1 : 0);
  })(),
);

// TODO: print report after running
