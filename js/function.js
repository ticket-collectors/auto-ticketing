const puppeteer = require('puppeteer');
const log = require('./js/log.js');

async function startTicketing(consertId, numberPerson, day, idToken, tempCookie, seatArea) {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--disable-web-security', '--disable-features=IsolateOrigins', ' --disable-site-isolation-trials']
    });

    let page = await browser.newPage();
    await page.setViewport({width: 1080, height: 1024});

    // 콘서트 페이지로 먼저 이동
    let consertUrl = 'https://tickets.interpark.com/special/sports/promotion/' + consertId;
    await page.goto(consertUrl);

    // 쿠키 설정
    await page.setCookie(
        {
            name: 'id_token',
            value: idToken,
            domain: '.interpark.com',
            path: '/',
            httpOnly: false,
            secure: true
        },
        {
            name: 'tempinterparkGUEST',
            value: tempCookie,
            domain: '.interpark.com',
            path: '/',
            httpOnly: false,
            secure: false
        }
    );
    await log.addLog("쿠키 설정 완료");

    // 쿠키 적용을 위해 페이지 새로고침
    await page.reload();
    await log.addLog("페이지 새로고침 완료");
    
    // if exsited popup -> close
    const popupCloseBut = '#popup-prdGuide > div > div.popupFooter > button'
    const closeButElement = await page.$(popupCloseBut);
    if(closeButElement != null) {
        await page.click(popupCloseBut);
    }

    // 예매 오픈 시간까지 기다리기
    // let startTime = new Date(2023, 3, 28, 11, 59, 59);
    // let now = new Date();
    // await new Promise(r => setTimeout(r, startTime.getTime() - now.getTime()));
    // page.reload();

    // 경기 목록이 로드될 때까지 대기
    await page.waitForSelector('.tournament-list_wrap__ldlRV');
    await log.addLog("경기 목록 로드 완료");

    // 날짜 기반으로 예매하기 버튼 찾기
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const targetDate = `${currentMonth}.${day}`; // "10.24" 형식
    await log.addLog(`${targetDate} 날짜의 예매하기 버튼 검색 중...`);

    // 모든 경기 항목 가져오기
    const tournamentItems = await page.$$('.tournament-item_wrap__ytvfE');

    let foundButton = null;
    for (const item of tournamentItems) {
        const dateElement = await item.$('.tournament-item_date_time__PCNaF');
        if (dateElement) {
            const dateText = await page.evaluate(el => el.textContent, dateElement);

            // 날짜가 일치하는지 확인 (예: "10.24(금) 18:30"에서 "10.24" 포함 여부)
            if (dateText.includes(targetDate)) {
                // 해당 항목의 예매하기 버튼 찾기
                foundButton = await item.$('button.flat-button_btn__nLKZo.flat-button_bg__XOZdR');
                if (foundButton) {
                    await log.addLog(`${targetDate} 날짜 경기 찾음: ${dateText}`);
                    break;
                }
            }
        }
    }

    if (!foundButton) {
        await log.addErrorLog(`${targetDate} 날짜의 예매하기 버튼을 찾을 수 없습니다`);
        return false;
    }

    // 예매하기
    // TODO : 티켓 오픈 예정 시간 입력 받아서 처리하는 로직
    // let startTime = new Date(2023, 3, 28, 11, 59, 59);
    // let now = new Date();
    // await new Promise(r => setTimeout(r, startTime.getTime() - now.getTime()));
    // await log.addLog("end wait");

    await foundButton.click();
    const newPagePromise = await new Promise(x => page.once('popup', x));
    await log.addLog("예매하기 버튼 클릭 성공");
    await page.setViewport({width: 1080, height: 1024});
    page = await newPagePromise;

    // 새창
    await page.waitForSelector('#divBookSeat');
    let iframeWindow = await page.$(
        'iframe[id="ifrmSeat"]'
    );

    let frame = await iframeWindow.contentFrame();

    // 잠깐 접어두기 클릭
    await Promise.all([
        await frame.waitForSelector('#divCaptchaFolding > a'),
        await frame.click('#divCaptchaFolding > a'),
    ]);

    // 좌석 선택 iframe으로 진입
    await frame.waitForSelector('#ifrmSeatDetail');
    iframeWindow = await frame.$(
        'iframe[id="ifrmSeatDetail"]'
    );
    let detailFrame = await iframeWindow.contentFrame();

    // 구역 선택 - groundList에서 원하는 구역 찾기
    await detailFrame.waitForSelector('.groundList .list');
    await log.addLog(`"${seatArea}" 구역 검색 중...`);

    // 모든 구역 링크 가져오기
    const areaLinks = await detailFrame.$$('.groundList .list a');
    let foundArea = null;

    for (const link of areaLinks) {
        const areaName = await detailFrame.evaluate(el => el.getAttribute('sgn'), link);

        if (areaName && areaName.includes(seatArea)) {
            foundArea = link;
            await log.addLog(`구역 찾음: ${areaName}`);
            break;
        }
    }

    if (!foundArea) {
        await log.addErrorLog(`"${seatArea}" 구역을 찾을 수 없습니다`);
        return false;
    }

    // 구역 클릭
    await foundArea.click();
    await log.addLog("구역 선택 완료");

    // "좌석선택" 버튼 클릭 (중요!)
    await detailFrame.waitForSelector('.twoBtn');
    const seatSelectButton = await detailFrame.$('a[onclick*="KBOGate.SetSeat"]');

    if (seatSelectButton) {
        await seatSelectButton.click();
        await log.addLog("'좌석선택' 버튼 클릭");
    } else {
        await log.addErrorLog("'좌석선택' 버튼을 찾을 수 없습니다");
        return false;
    }

    // #divSeatBox 나오면 자동으로 좌석 클릭
    await detailFrame.waitForSelector('#divSeatBox');
    await log.addLog("좌석 목록 로드 완료");
    const seatArr = await detailFrame.$$('span[class="SeatN"]');
    
    for (let index = 0; index < numberPerson; index++) {
        if(index+1 > seatArr.length) {
            log.addErrorLog("잔여좌석 " + seatArr.length + "개로 " + numberPerson-seatArr.length + "개의 좌석은 잡지 못했습니다.");
            break;
        }
        await seatArr[index].click();
        await log.addLog("select seat");
    }

    // 좌석 선택 완료 버튼 클릭
    await frame.click('body > form:nth-child(2) > div > div.contWrap > div.seatR > div > div.btnWrap > a');
    await log.addLog("좌석 선택 완료");

    await sleep(50000);

    // 사용자가 수기로 문자열 입력

    
    // await Promise.all([
    //     frame.click(arr[0]),
    //     frame.click(arr[1])
    // ]);
    
    // frame.click(area의 title이 036영역);

    // 완료

    // 문자열 입력 -> 결제 알아서 완료하기
    // const imgId = '#imgCaptcha';
    // await frame.waitForSelector(imgId);
    // let imgUrl = await frame.$eval(imgId, el => el.getAttribute('src'));

    // const worker = await createWorker();
    // (async () => {
    //     await worker.loadLanguage('eng');
    //     await worker.initialize('eng');
    //     const { data: { text } } = await worker.recognize(imgUrl);
    //     console.log('OCR :' + text);
    //     await worker.terminate();
    //   })();
    return true;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}