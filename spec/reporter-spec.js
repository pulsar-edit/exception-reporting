/** @babel */

import Reporter from '../lib/reporter'
import os from 'os'
let osVersion = `${os.platform()}-${os.arch()}-${os.release()}`

let getReleaseChannel = version => {
  return (version.indexOf('beta') > -1)
    ? 'beta'
    : (version.indexOf('dev') > -1)
    ? 'dev'
    : 'stable'
}

describe("Reporter", () => {
  let [requests, initialStackTraceLimit, mockActivePackages] = []

  beforeEach(() => {
    requests = []
    mockActivePackages = []
    spyOn(atom.packages, 'getActivePackages').andCallFake(() => mockActivePackages)

    initialStackTraceLimit = Error.stackTraceLimit
    Error.stackTraceLimit = 1

    Reporter.setRequestFunction((url, options) => requests.push(Object.assign({url}, options)))
    Reporter.alwaysReport = true
  })

  afterEach(() => Error.stackTraceLimit = initialStackTraceLimit)

  describe(".reportUncaughtException(error)", () => {
    it("posts errors to bugsnag", () => {
      let error = new Error()
      Error.captureStackTrace(error)
      Reporter.reportUncaughtException(error)
      let [lineNumber, columnNumber] = error.stack.match(/.js:(\d+):(\d+)/).slice(1).map(s => parseInt(s))

      expect(requests.length).toBe(1)
      let [request] = requests
      expect(request.method).toBe("POST")
      expect(request.url).toBe("https://notify.bugsnag.com")
      expect(request.headers.get("Content-Type")).toBe("application/json")
      let body = JSON.parse(request.body)

      // asserting the correct path is difficult on CI. let's do 'close enough'.
      expect(body.events[0].exceptions[0].stacktrace[0].file).toMatch(/reporter-spec/)
      expect(body.events[0].exceptions[0].stacktrace[0].file).not.toMatch(/\\/)
      delete body.events[0].exceptions[0].stacktrace[0].file
      delete body.events[0].exceptions[0].stacktrace[0].inProject

      expect(body).toEqual({
        "apiKey": Reporter.API_KEY,
        "notifier": {
          "name": "Atom",
          "version": Reporter.LIB_VERSION,
          "url": "https://www.atom.io"
        },
        "events": [
          {
            "payloadVersion": "2",
            "exceptions": [
              {
                "errorClass": "Error",
                "message": "",
                "stacktrace": [
                  {
                    "method": ".<anonymous>",
                    "lineNumber": lineNumber,
                    "columnNumber": columnNumber
                  }
                ]
              }
            ],
            "severity": "error",
            "user": {},
            "app": {
              "version": atom.getVersion(),
              "releaseStage": getReleaseChannel(atom.getVersion())
            },
            "device": {
              "osVersion": osVersion
            }
          }
        ]
      });})

    describe("when the error object has `privateMetadata` and `privateMetadataDescription` fields", () => {
      let [error, notification] = []

      beforeEach(() => {
        atom.notifications.clear()
        spyOn(atom.notifications, 'addInfo').andCallThrough()

        error = new Error()
        Error.captureStackTrace(error)

        error.metadata = {foo: "bar"}
        error.privateMetadata = {baz: "quux"}
        error.privateMetadataDescription = "The contents of baz"
      })

      it("posts a notification asking for consent", () => {
        Reporter.reportUncaughtException(error)
        expect(atom.notifications.addInfo).toHaveBeenCalled()
      })

      it("submits the error with the private metadata if the user consents", () => {
        spyOn(Reporter, 'reportUncaughtException').andCallThrough()
        Reporter.reportUncaughtException(error)
        Reporter.reportUncaughtException.reset()

        notification = atom.notifications.getNotifications()[0]

        let notificationOptions = atom.notifications.addInfo.argsForCall[0][1]
        expect(notificationOptions.buttons[1].text).toMatch(/Yes/)

        notificationOptions.buttons[1].onDidClick()
        expect(Reporter.reportUncaughtException).toHaveBeenCalledWith(error)
        expect(Reporter.reportUncaughtException.callCount).toBe(1)
        expect(error.privateMetadata).toBeUndefined()
        expect(error.privateMetadataDescription).toBeUndefined()
        expect(error.metadata).toEqual({foo: "bar", baz: "quux"})

        expect(notification.isDismissed()).toBe(true)
      })

      it("submits the error without the private metadata if the user does not consent", () => {
        spyOn(Reporter, 'reportUncaughtException').andCallThrough()
        Reporter.reportUncaughtException(error)
        Reporter.reportUncaughtException.reset()

        notification = atom.notifications.getNotifications()[0]

        let notificationOptions = atom.notifications.addInfo.argsForCall[0][1]
        expect(notificationOptions.buttons[0].text).toMatch(/No/)

        notificationOptions.buttons[0].onDidClick()
        expect(Reporter.reportUncaughtException).toHaveBeenCalledWith(error)
        expect(Reporter.reportUncaughtException.callCount).toBe(1)
        expect(error.privateMetadata).toBeUndefined()
        expect(error.privateMetadataDescription).toBeUndefined()
        expect(error.metadata).toEqual({foo: "bar"})

        expect(notification.isDismissed()).toBe(true)
      })

      it("submits the error without the private metadata if the user dismisses the notification", () => {
        spyOn(Reporter, 'reportUncaughtException').andCallThrough()
        Reporter.reportUncaughtException(error)
        Reporter.reportUncaughtException.reset()

        notification = atom.notifications.getNotifications()[0]
        notification.dismiss()

        expect(Reporter.reportUncaughtException).toHaveBeenCalledWith(error)
        expect(Reporter.reportUncaughtException.callCount).toBe(1)
        expect(error.privateMetadata).toBeUndefined()
        expect(error.privateMetadataDescription).toBeUndefined()
        expect(error.metadata).toEqual({foo: "bar"});});})

    it("adds bundled and user packages to the error's metadata", () => {
      mockActivePackages = [
        {name: 'user-1', path: '/Users/user/.atom/packages/user-1', metadata: {version: '1.0.0'}},
        {name: 'user-2', path: '/Users/user/.atom/packages/user-2', metadata: {version: '1.2.0'}},
        {name: 'bundled-1', path: '/Applications/Atom.app/Contents/Resources/app.asar/node_modules/bundled-1', metadata: {version: '1.0.0'}},
        {name: 'bundled-2', path: '/Applications/Atom.app/Contents/Resources/app.asar/node_modules/bundled-2', metadata: {version: '1.2.0'}},
      ]

      let error = new Error()
      Error.captureStackTrace(error)
      Reporter.reportUncaughtException(error)

      expect(error.metadata.userPackages).toEqual({
        'user-1': '1.0.0',
        'user-2': '1.2.0'
      })
      expect(error.metadata.bundledPackages).toEqual({
        'bundled-1': '1.0.0',
        'bundled-2': '1.2.0'
      })
    })
  })

  describe(".reportFailedAssertion(error)", () => {
    it("posts warnings to bugsnag", () => {
      let error = new Error()
      Error.captureStackTrace(error)
      Reporter.reportFailedAssertion(error)
      let [lineNumber, columnNumber] = error.stack.match(/.js:(\d+):(\d+)/).slice(1).map(s => parseInt(s))

      expect(requests.length).toBe(1)
      let [request] = requests
      expect(request.method).toBe("POST")
      expect(request.url).toBe("https://notify.bugsnag.com")
      expect(request.headers.get("Content-Type")).toBe("application/json")
      let body = JSON.parse(request.body)

      // asserting the correct path is difficult on CI. let's do 'close enough'.
      expect(body.events[0].exceptions[0].stacktrace[0].file).toMatch(/reporter-spec/)
      expect(body.events[0].exceptions[0].stacktrace[0].file).not.toMatch(/\\/)
      delete body.events[0].exceptions[0].stacktrace[0].file
      delete body.events[0].exceptions[0].stacktrace[0].inProject

      expect(body).toEqual({
        "apiKey": Reporter.API_KEY,
        "notifier": {
          "name": "Atom",
          "version": Reporter.LIB_VERSION,
          "url": "https://www.atom.io"
        },
        "events": [
          {
            "payloadVersion": "2",
            "exceptions": [
              {
                "errorClass": "Error",
                "message": "",
                "stacktrace": [
                  {
                    "method": ".<anonymous>",
                    "lineNumber": lineNumber,
                    "columnNumber": columnNumber
                  }
                ]
              }
            ],
            "severity": "warning",
            "user": {},
            "app": {
              "version": atom.getVersion(),
              "releaseStage": getReleaseChannel(atom.getVersion())
            },
            "device": {
              "osVersion": osVersion
            }
          }
        ]
      });})

    describe("when the error object has `privateMetadata` and `privateMetadataDescription` fields", () => {
      let [error, notification] = []

      beforeEach(() => {
        atom.notifications.clear()
        spyOn(atom.notifications, 'addInfo').andCallThrough()

        error = new Error()
        Error.captureStackTrace(error)

        error.metadata = {foo: "bar"}
        error.privateMetadata = {baz: "quux"}
        error.privateMetadataDescription = "The contents of baz"
      })

      it("posts a notification asking for consent", () => {
        Reporter.reportFailedAssertion(error)
        expect(atom.notifications.addInfo).toHaveBeenCalled()
      })

      it("submits the error with the private metadata if the user consents", () => {
        spyOn(Reporter, 'reportFailedAssertion').andCallThrough()
        Reporter.reportFailedAssertion(error)
        Reporter.reportFailedAssertion.reset()

        notification = atom.notifications.getNotifications()[0]

        let notificationOptions = atom.notifications.addInfo.argsForCall[0][1]
        expect(notificationOptions.buttons[1].text).toMatch(/Yes/)

        notificationOptions.buttons[1].onDidClick()
        expect(Reporter.reportFailedAssertion).toHaveBeenCalledWith(error)
        expect(Reporter.reportFailedAssertion.callCount).toBe(1)
        expect(error.privateMetadata).toBeUndefined()
        expect(error.privateMetadataDescription).toBeUndefined()
        expect(error.metadata).toEqual({foo: "bar", baz: "quux"})

        expect(notification.isDismissed()).toBe(true)
      })

      it("submits the error without the private metadata if the user does not consent", () => {
        spyOn(Reporter, 'reportFailedAssertion').andCallThrough()
        Reporter.reportFailedAssertion(error)
        Reporter.reportFailedAssertion.reset()

        notification = atom.notifications.getNotifications()[0]

        let notificationOptions = atom.notifications.addInfo.argsForCall[0][1]
        expect(notificationOptions.buttons[0].text).toMatch(/No/)

        notificationOptions.buttons[0].onDidClick()
        expect(Reporter.reportFailedAssertion).toHaveBeenCalledWith(error)
        expect(Reporter.reportFailedAssertion.callCount).toBe(1)
        expect(error.privateMetadata).toBeUndefined()
        expect(error.privateMetadataDescription).toBeUndefined()
        expect(error.metadata).toEqual({foo: "bar"})

        expect(notification.isDismissed()).toBe(true)
      })

      it("submits the error without the private metadata if the user dismisses the notification", () => {
        spyOn(Reporter, 'reportFailedAssertion').andCallThrough()
        Reporter.reportFailedAssertion(error)
        Reporter.reportFailedAssertion.reset()

        notification = atom.notifications.getNotifications()[0]
        notification.dismiss()

        expect(Reporter.reportFailedAssertion).toHaveBeenCalledWith(error)
        expect(Reporter.reportFailedAssertion.callCount).toBe(1)
        expect(error.privateMetadata).toBeUndefined()
        expect(error.privateMetadataDescription).toBeUndefined()
        expect(error.metadata).toEqual({foo: "bar"})
      })

      it("only notifies the user once for a given 'privateMetadataRequestName'", () => {
        let fakeStorage = {}
        spyOn(global.localStorage, 'setItem').andCallFake((key, value) => fakeStorage[key] = value)
        spyOn(global.localStorage, 'getItem').andCallFake(key => fakeStorage[key])

        error.privateMetadataRequestName = 'foo'

        Reporter.reportFailedAssertion(error)
        expect(atom.notifications.addInfo).toHaveBeenCalled()
        atom.notifications.addInfo.reset()

        Reporter.reportFailedAssertion(error)
        expect(atom.notifications.addInfo).not.toHaveBeenCalled()

        let error2 = new Error()
        Error.captureStackTrace(error2)
        error2.privateMetadataDescription = 'Something about you'
        error2.privateMetadata = {baz: 'quux'}
        error2.privateMetadataRequestName = 'bar'

        Reporter.reportFailedAssertion(error2)
        expect(atom.notifications.addInfo).toHaveBeenCalled()
      })
    })

    it("adds bundled and user packages to the error's metadata", () => {
      mockActivePackages = [
        {name: 'user-1', path: '/Users/user/.atom/packages/user-1', metadata: {version: '1.0.0'}},
        {name: 'user-2', path: '/Users/user/.atom/packages/user-2', metadata: {version: '1.2.0'}},
        {name: 'bundled-1', path: '/Applications/Atom.app/Contents/Resources/app.asar/node_modules/bundled-1', metadata: {version: '1.0.0'}},
        {name: 'bundled-2', path: '/Applications/Atom.app/Contents/Resources/app.asar/node_modules/bundled-2', metadata: {version: '1.2.0'}},
      ]

      let error = new Error()
      Error.captureStackTrace(error)
      Reporter.reportFailedAssertion(error)

      expect(error.metadata.userPackages).toEqual({
        'user-1': '1.0.0',
        'user-2': '1.2.0'
      })
      expect(error.metadata.bundledPackages).toEqual({
        'bundled-1': '1.0.0',
        'bundled-2': '1.2.0'
      })
    })
  })
})