import * as http2 from 'http2';
import { window } from 'vscode';
import * as assert from 'assert';
import * as net from 'net';
import * as url from 'url';

const https_proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
const debug = console.log;


function getScoketFromProxy(https_proxy: string, dst_url: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        let option = url.parse(https_proxy);
        let host = option.hostname || option.host;
        if (!host || !option.port) {
            debug(option);
            return reject(https_proxy);
        }
        let port = parseInt(option.port);
        let socket = net.connect({ host: host, port: port });
        let buffers: Buffer[] = [];
        let buffersLength = 0;

        function read() {
            debug("read");
            var b = socket.read();
            if (b) {
                debug("before ondata");
                ondata(b);
            }
            else {
                socket.once('readable', read);
            }
        }

        function cleanup() {
            debug('cleanup');
            socket.removeListener('end', onend);
            socket.removeListener('error', onerror);
            socket.removeListener('close', onclose);
            socket.removeListener('readable', read);
        }


        function onclose(err: any) {
            debug('onclose had error %o', err);
        }


        function onend() {
            debug('onend');
        }


        function onerror(err: any) {
            debug("onerror", err);
            cleanup();
            reject(err);
        }

        function ondata(b: Buffer) {
            // debug(b);
            buffers.push(b);
            debug(buffers);
            buffersLength += b.length;
            var buffered = Buffer.concat(buffers, buffersLength);
            debug(buffered);
            var str = buffered.toString('ascii');
            debug(str);

            if (!~str.indexOf('\r\n\r\n')) {
                // keep buffering
                debug('have not received end of HTTP headers yet...');
                read();
                return;
            }

            var firstLine = str.substring(0, str.indexOf('\r\n'));
            var statusCode = +firstLine.split(' ')[1];
            debug('got proxy server response: %o', firstLine);

            cleanup();
            if (200 === statusCode) {
                resolve(socket);
            } else {
                socket.destroy();
                reject(statusCode);
            }
        }


        socket.on('error', onerror);
        socket.on('close', onclose);
        socket.on('end', onend);

        read();

        var msg = 'CONNECT ' + dst_url + ':443' + ' HTTP/1.1\r\n';

        var headers = Object.assign({});

        // the Host header should only include the port
        // number when it is a non-standard port

        headers['Host'] = dst_url;

        // headers['Connection'] = 'close';
        Object.keys(headers).forEach(function (name) {
            msg += name + ': ' + headers[name] + '\r\n';
        });
        debug(msg);
        socket.write(msg + '\r\n');

    });
}

class H2Client {

    h2client?: http2.ClientHttp2Session | Promise<http2.ClientHttp2Session | undefined>;

    resetWithSocket(socket?: net.Socket): http2.ClientHttp2Session {
        debug(socket);
        let opt;
        if (socket) {
            opt = { socket: socket };
        }
        let h2client = http2.connect(this.url, opt);
        h2client.setTimeout(1000);
        const add_client_on = (event: string) =>
            h2client.on(event, (err) => {
                debug(`${this.url}: ${event} ${err}`);
                if (this.h2client === h2client) {
                    this.h2client = undefined;
                }
            });

        add_client_on('error');
        add_client_on('close');
        add_client_on('goaway');
        return h2client;
    }

    reset() {
        if (https_proxy) {
            let url = this.url.split('//')[1];
            this.h2client = getScoketFromProxy(https_proxy, url)
                .then((socket) => {
                    let h2client = this.resetWithSocket(socket);
                    this.h2client = h2client;
                    return h2client;
                }).catch(() => { this.h2client = undefined; return undefined; });
        }
        else {
            this.h2client = this.resetWithSocket();
        }
    }

    constructor(readonly url: string) {
        this.reset();
    }

    async getClientAsync(): Promise<http2.ClientHttp2Session | undefined> {
        if (!this.h2client) {
            this.reset();
        }
        let h2client = <http2.ClientHttp2Session>this.h2client;
        if (h2client) {
            return Promise.resolve(h2client);
        }
        return <Promise<http2.ClientHttp2Session | undefined>>this.h2client;
    }

    async post(path: string) {
        let h2client = await this.getClientAsync();
        if (!h2client) {
            throw new Error('h2client failed');
        }
        return await this.postWithClient(path, h2client);
    }

    async postWithClient(path: string, h2client: http2.ClientHttp2Session): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            try {
                // window.showInformationMessage(path);
                const req = h2client.request({
                    ':path': path, 'method': 'post'
                });
                req.setEncoding('utf8');

                let data = '';
                req.on('data', (chunk) => { data += chunk; });
                req.on('end', () => {
                    // debug(`\n${data}`);
                    resolve(data);
                });
                // maybe need to handle more `on`
                const add_req_on = (event: string) => {
                    req.on(event, () => window.showInformationMessage(event));
                };
                req.end();
            } catch {
                if (this.h2client === h2client) {
                    this.h2client = undefined;
                }
                resolve(undefined);
            }
        });
    }
}

export interface SearchResult {
    nword: string;
    matchedLength: number;
}


export class Cloudinput {
    h2client = new H2Client('https://inputtools.google.com');
    async search(input: string, limit: number): Promise<Array<SearchResult> | undefined> {
        if (!input) {
            return [];
        }
        const url = `/request?text=${input}&itc=ne-t-i0-und&num=${limit}&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage`;


        const response = await this.h2client.post(url);
        if (!response) {
            return undefined;
        }

        const fn_parse_may_throw = () => {

            const json = JSON.parse(response);
            assert(json[0] === "SUCCESS");

            const nwordList = <Array<string>>json[1][0][1];
            const matchedLengthList = <Array<number> | undefined>json[1][0][3]["matched_length"];
            if (!matchedLengthList) {
                return nwordList.map((nword: string) =>
                    ({ nword, matchedLength: input.length })
                );
            }
            assert(nwordList.length === matchedLengthList.length);

            return nwordList.map((nword: string, i: number) =>
                ({ nword, matchedLength: matchedLengthList[i] })
            );
        };
        try {
            return fn_parse_may_throw();
        } catch (e) {
            window.showInformationMessage(`parse error on ${response}`);
            return undefined;
        }
    }
}

