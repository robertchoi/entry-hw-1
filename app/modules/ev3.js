const _ = require('lodash');
const BaseModule = require('./baseModule');

class ev3 extends BaseModule {
    constructor() {
        super();
        this.counter = 0;
        this.responseSize = 11;
        this.isSendInitData = false;
        this.isSensorCheck = false;
        this.isConnect = false;

        this.sp = null;
        this.sensors = [];
        this.CHECK_PORT_MAP = {};
        this.CHECK_SENSOR_MAP = {};
        this.SENSOR_COUNTER_LIST = {};
        this.returnData = {};
        this.motorMovementTypes = {
            Degrees: 0,
            Power: 1,
        };
        this.deviceTypes = {
            NxtTouch: 1,
            NxtLight: 2,
            NxtSound: 3,
            NxtColor: 4,
            NxtUltrasonic: 5,
            NxtTemperature: 6,
            LMotor: 7,
            MMotor: 8,
            Touch: 16,
            Color: 29,
            Ultrasonic: 30,
            Gyroscope: 32,
            Infrared: 33,
            Initializing: 0x7d,
            Empty: 0x7e,
            WrongPort: 0x7f,
            Unknown: 0xff,
        };
        this.outputPort = {
            A: 1,
            B: 2,
            C: 4,
            D: 8,
            ALL: 15,
        };
        this.sensorMode = {
            Touch: 0,
            Color: 2,
            Ultrasonic: 0,
            Gyroscope: 0,
        };
        this.PORT_MAP = {
            A: {
                type: this.motorMovementTypes.Power,
                power: 0,
            },
            B: {
                type: this.motorMovementTypes.Power,
                power: 0,
            },
            C: {
                type: this.motorMovementTypes.Power,
                power: 0,
            },
            D: {
                type: this.motorMovementTypes.Power,
                power: 0,
            },
        };
        this.SENSOR_MAP = {
            '1': {
                type: this.deviceTypes.Touch,
                mode: 0,
            },
            '2': {
                type: this.deviceTypes.Touch,
                mode: 0,
            },
            '3': {
                type: this.deviceTypes.Touch,
                mode: 0,
            },
            '4': {
                type: this.deviceTypes.Touch,
                mode: 0,
            },
        };
        this.isSensing = false;
        this.LAST_PORT_MAP = null;
    }

    /**
     * Direct Send Command 의 앞 부분을 설정한다.
     *
     * @param mode 3byte. mode & header 를 나타낸다.
     * mode = 0x00(reply required), 0x80(no reply)
     * header = 할당된 결과값 byte 수를 나타낸다. 이 값이 4인 경우, 4byte 를 result value 로 사용한다.
     * @returns {Buffer} size(2byte) + counter(2byte) + mode(1byte) + header(2byte)
     */
    makeInitBuffer(mode) {
        const size = new Buffer([255, 255]); // dummy 에 가깝다. #checkByteSize 에서 갱신된다.
        const counter = this.getCounter();
        const reply = new Buffer(mode);
        return Buffer.concat([size, counter, reply]);
    }

    /**
     * 카운터를 가져온다. 카운터 값은 request & response 가 동일하여, 정상값 체크를 위해 사용된다.
     * 이 값은 2^15 이상인 경우 0으로 초기화한다.
     * @returns {Buffer} little endian 2byte
     */
    getCounter() {
        let counterBuf = new Buffer(2);
        counterBuf.writeInt16LE(this.counter);
        if (this.counter >= 32767) {
            this.counter = 0;
        }
        this.counter++;
        return counterBuf;
    }

    /**
     * size 를 해당하는 2byte 를 제외한 값을 size 에 씌운다.
     *
     * TODO 그렇다면 makeInitBuffer의 size는 영원히 아무일도 하지 않는다.
     * @param buffer 파라미터가 완성된 buffer
     */
    checkByteSize(buffer) {
        const bufferLength = buffer.length - 2;
        buffer[0] = bufferLength;
        buffer[1] = bufferLength >> 8; // buffer length 가 2^8 을 넘는 값일경우, 남은 값을 다음 size byte 에 씌운다.
    }

    /**
     * 센서를 200ms 간격으로 체크한다. 센싱중에는 체크하지 않는다.
     */
    sensorChecking() {
        if (!this.isSensorCheck) {
            this.sensing = setInterval(() => {
                this.sensorCheck();
                this.isSensing = false;
            }, 200);
            this.isSensorCheck = true;
        }
    }

    /**
     * TODO
     * 전체 디바이스 목록 중 찾고자 하는 결과를 가져온다.
     * @param type 찾고자 하는 디바이스 타입 hex 값
     * @returns {*} 존재하는 경우 디바이스 타입의 명칭, 없으면 null
     */
    getSensorType(type) {
        let returnType;
        for (const key in this.deviceTypes) {
            if (this.deviceTypes[key] === type) {
                returnType = key;
                break;
            }
        }
        return returnType;
    }

    init(handler, config) {}

    lostController() {}

    eventController(state) {
        if (state === 'connected') {
            clearInterval(this.sensing);
        }
    }

    setSerialPort(sp) {
        this.sp = sp;
    }

    /**
     * 모터를 정지하고, output 센서를 체크한다.
     * @param sp serial port
     * @returns {null} 직접 serial port 에 ByteArray 를 작성한다.
     */
    requestInitialData(sp) {
        this.isConnect = true;
        if (!this.sp) {
            this.sp = sp;
        }

        if (!this.isSendInitData) {
            const initBuf = this.makeInitBuffer([128, 0, 0]);
            const motorStop = new Buffer([163, 129, 0, 129, 15, 129, 0]);
            const initMotor = Buffer.concat([initBuf, motorStop]);
            this.checkByteSize(initMotor);
            sp.write(initMotor, () => {
                this.sensorChecking();
            });
        }
        return null;
    }

    checkInitialData(data, config) {
        return true;
    }

    handleLocalData(data) {
        // data: Native Buffer
        /* 97 이 header 에서 alloc size 고정으로 인해 0x61로 들어오게됨. 수정 요망*/
        if (data[0] === 97 && data[1] === 0) {
            const countKey = data.readInt16LE(2);
            if (countKey in this.SENSOR_COUNTER_LIST) {
                this.isSensing = false;
                delete this.SENSOR_COUNTER_LIST[countKey];
                data = data.slice(5);
                let index = 0;
                Object.keys(this.SENSOR_MAP).forEach((p) => {
                    const port = Number(p) - 1;
                    index = port * this.responseSize;

                    const type = data[index];
                    const mode = data[index + 1];
                    let siValue = Number(
                        (data.readFloatLE(index + 2) || 0).toFixed(1)
                    );
                    // siValue = Number(siValue.toFixed(1));
                    const readyRaw = data.readInt32LE(index + 6);
                    const readyPercent = data[index + 10];

                    this.returnData[p] = {
                        type: type,
                        mode: mode,
                        siValue: siValue,
                        readyRaw: readyRaw,
                        readyPercent: readyPercent,
                    };
                });
            }
        }
    }

    // Web Socket(엔트리)에 전달할 데이터
    requestRemoteData(handler) {
        Object.keys(this.returnData).forEach((key) => {
            if (this.returnData[key] !== undefined) {
                handler.write(key, this.returnData[key]);
            }
        });
    }

    // Web Socket 데이터 처리
    handleRemoteData(handler) {
        Object.keys(this.PORT_MAP).forEach((port) => {
            this.PORT_MAP[port] = handler.read(port);
        });
        Object.keys(this.SENSOR_MAP).forEach((port) => {
            this.SENSOR_MAP[port] = handler.read(port);
        });
    }

    // 하드웨어에 전달할 데이터
    requestLocalData() {
        let isSendData = false;
        const initBuf = this.makeInitBuffer([128, 0, 0]);
        const time = 0;
        let sendBody;
        this.sensorCheck();
        let skipOutput = false;
        if (this.LAST_PORT_MAP) {
            const arr = Object.keys(this.PORT_MAP).filter((port) => {
                const map1 = this.PORT_MAP[port];
                const map2 = this.LAST_PORT_MAP[port];
                return !(map1.type === map2.type && map1.power === map2.power);
            });
            skipOutput = arr.length === 0;
        }

        if (skipOutput) {
            return null;
        }

        this.LAST_PORT_MAP = _.cloneDeep(this.PORT_MAP);
        Object.keys(this.PORT_MAP).forEach((port) => {
            let backBuffer;
            let frontBuffer;
            const portMap = this.PORT_MAP[port];
            let brake = 0;
            let checkPortMap = this.CHECK_PORT_MAP[port];
            if (!checkPortMap || portMap.id !== checkPortMap.id) {
                isSendData = true;
                let portOut;
                let power = Number(portMap.power);
                if (portMap.type === this.motorMovementTypes.Power) {
                    const time = Number(portMap.time) || 0;
                    brake = 0;
                    if (power > 100) {
                        power = 100;
                    } else if (power < -100) {
                        power = -100;
                    } else if (power === 0) {
                        brake = 1;
                    }

                    if (time <= 0) {
                        // ifinity output port mode
                        portOut = new Buffer([
                            164,
                            129,
                            0,
                            129,
                            this.outputPort[port],
                            129,
                            power,
                            166,
                            129,
                            0,
                            129,
                            this.outputPort[port],
                        ]);
                    } else {
                        // timeset mode 232, 3 === 1000ms
                        frontBuffer = new Buffer([
                            173,
                            129,
                            0,
                            129,
                            this.outputPort[port],
                            129,
                            power,
                            131,
                            0,
                            0,
                            0,
                            0,
                            131,
                        ]);
                        backBuffer = new Buffer([131, 0, 0, 0, 0, 129, brake]);
                        const timeBuffer = new Buffer(4);
                        timeBuffer.writeInt32LE(time);
                        portOut = Buffer.concat([
                            frontBuffer,
                            timeBuffer,
                            backBuffer,
                        ]);
                    }
                } else {
                    const degree = Number(portMap.degree) || 0;
                    frontBuffer = new Buffer([
                        172,
                        129,
                        0,
                        129,
                        this.outputPort[port],
                        129,
                        power,
                        131,
                        0,
                        0,
                        0,
                        0,
                        131,
                    ]);
                    backBuffer = new Buffer([131, 0, 0, 0, 0, 129, brake]);
                    const degreeBuffer = new Buffer(4);
                    degreeBuffer.writeInt32LE(degree);
                    portOut = Buffer.concat([
                        frontBuffer,
                        degreeBuffer,
                        backBuffer,
                    ]);
                }

                if (portOut) {
                    if (!sendBody) {
                        sendBody = new Buffer(portOut);
                    } else {
                        sendBody = Buffer.concat([sendBody, portOut]);
                    }
                }

                this.CHECK_PORT_MAP[port] = this.PORT_MAP[port];
            }
        });

        if (isSendData && sendBody) {
            const totalLength = initBuf.length + sendBody.length;
            const sendBuffer = Buffer.concat([initBuf, sendBody], totalLength);
            this.checkByteSize(sendBuffer);
            this.lastMotorData = sendBuffer;
            return sendBuffer;
        }

        return null;
    }

    /**
     * requestInitialData(external interval) -> sensorChecking(interval) -> sensorCheck
     * 센서데이터를 연결해 한번에 보낸다.
     * output 이 존재하는 Port 1,2,3,4 번을 체크한다.
     *
     * 보내는 데이터는 여러개의 데이터 명령이고 받는 결과 또한 여러개의 결과값이다.
     */
    sensorCheck() {
        if (!this.isSensing) {
            this.isSensing = true;
            const initBuf = this.makeInitBuffer([0, 94, 0]);
            const counter = initBuf.readInt16LE(2); // initBuf의 index(2) 부터 2byte 는 counter 에 해당
            this.SENSOR_COUNTER_LIST[counter] = true;
            let sensorBody = [];
            let index = 0;
            Object.keys(this.SENSOR_MAP).forEach((p) => {
                let mode = 0;
                if (this.returnData[p] && this.returnData[p]['type']) {
                    const type = this.getSensorType(this.returnData[p]['type']);
                    mode = this.SENSOR_MAP[p]['mode'] || 0;
                }
                const port = Number(p) - 1;
                index = port * this.responseSize;
                const modeSet = new Buffer([
                    153,
                    5,
                    129,
                    0,
                    129,
                    port,
                    225,
                    index,
                    225,
                    index + 1,
                ]);
                const readySi = new Buffer([
                    153,
                    29,
                    129,
                    0,
                    129,
                    port,
                    129,
                    0,
                    129,
                    mode,
                    129,
                    1,
                    225,
                    index + 2,
                ]);
                const readyRaw = new Buffer([
                    153,
                    28,
                    129,
                    0,
                    129,
                    port,
                    129,
                    0,
                    129,
                    mode,
                    129,
                    1,
                    225,
                    index + 6,
                ]);
                const readyPercent = new Buffer([
                    153,
                    27,
                    129,
                    0,
                    129,
                    port,
                    129,
                    0,
                    129,
                    mode,
                    129,
                    1,
                    225,
                    index + 10,
                ]);

                if (!sensorBody.length) {
                    sensorBody = Buffer.concat([
                        modeSet,
                        readySi,
                        readyRaw,
                        readyPercent,
                    ]);
                } else {
                    sensorBody = Buffer.concat([
                        sensorBody,
                        modeSet,
                        readySi,
                        readyRaw,
                        readyPercent,
                    ]);
                }
            });
            /*
			* 이 부분에 is Button Pressed 관련 로직을 추가한다.
			* */

            const totalLength = initBuf.length + sensorBody.length;
            const sendBuffer = Buffer.concat(
                [initBuf, sensorBody],
                totalLength
            );
            this.checkByteSize(sendBuffer);
            this.sp.write(sendBuffer);
        }
    }

    connect() {}

    disconnect(connect) {
        if (this.isConnect) {
            clearInterval(this.sensing);
            this.counter = 0;
            this.responseSize = 11;
            this.isSendInitData = false;
            this.isSensorCheck = false;
            // this.sp.flush();
            this.isConnect = false;

            if (this.sp) {
                this.sp.write(
                    new Buffer('070055008000000201', 'hex'),
                    (err) => {
                        // no reply, OpProgram_Stop(programID=01)
                        this.sp = null;
                        if (err) {
                            console.log(err);
                        }
                        connect.close();
                    }
                );
            } else {
                connect.close();
            }
        }
    }

    reset() {}
}

module.exports = new ev3();
