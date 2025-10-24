import 'package:bluebubbles/helpers/backend/settings_helpers.dart';
import 'package:bluebubbles/helpers/helpers.dart';
import 'package:bluebubbles/app/layouts/setup/dialogs/connecting_dialog.dart';
import 'package:bluebubbles/app/layouts/setup/dialogs/failed_to_scan_dialog.dart';
import 'package:bluebubbles/app/wrappers/stateful_boilerplate.dart';
import 'package:bluebubbles/database/models.dart';
import 'package:bluebubbles/services/services.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart' hide Response;

class ManualEntryDialog extends StatefulWidget {
  ManualEntryDialog({super.key, required this.onConnect, required this.onClose});
  final Function() onConnect;
  final Function() onClose;

  @override
  State<ManualEntryDialog> createState() => _ManualEntryDialogState();
}

class _ManualEntryDialogState extends OptimizedState<ManualEntryDialog> {
  bool connecting = false;
  final TextEditingController urlController = TextEditingController();
  final TextEditingController passwordController = TextEditingController();
  String? error;

  void connect(String url, String password) async {
    if (url.endsWith("/")) {
      url = url.substring(0, url.length - 1);
    }
    if (kIsWeb && url.startsWith("http://")) {
      error = "HTTP URLs are not supported on Web! You must use an HTTPS URL.";
      setState(() {});
      return;
    }
    // Check if the URL is valid
    bool isValid = url.isURL;
    if (url.contains(":") && !isValid) {
      // port applied to URL
      if (":".allMatches(url).length == 2) {
        final newUrl = url.split(":")[1].split("/").last;
        isValid = "https://${(newUrl.split(".")..removeLast()).join(".")}.com".isURL || newUrl.isIPv6 || newUrl.isIPv4;
      } else {
        final newUrl = url.split(":").first;
        isValid = newUrl.isIPv6 || newUrl.isIPv4;
      }
    }
    // the getx regex only allows extensions up to 6 characters in length
    // this is a workaround for that
    if (!isValid && url.split(".").last.isAlphabetOnly && url.split(".").last.length > 6) {
      final newUrl = (url.split(".")..removeLast()).join(".");
      isValid = ("$newUrl.com").isURL;
    }

    // If the URL is invalid, or the password is invalid, show an error
    if (!isValid || password.isEmpty) {
      error = "Please enter a valid URL and password!";
      setState(() {});
      return;
    }

    String? addr = sanitizeServerAddress(address: url);
    if (addr == null) {
      error = "Server address is invalid!";
      setState(() {});
      return;
    }

    ss.settings.guidAuthKey.value = password;
    await saveNewServerUrl(addr, restartSocket: false, force: true, saveAdditionalSettings: ["guidAuthKey"]);

    try {
      socket.restartSocket();
    } catch (e) {
      error = e.toString();
      if (mounted) setState(() {});
    }
  }

  void retreiveFCMData() {
    // Get the FCM Client and make sure we have a valid response
    // If so, save. Let the parent widget know we've connected as long as
    // we get 200 from the API.
    http.fcmClient().then((response) async {
      Map<String, dynamic>? data = response.data["data"];
      if (!isNullOrEmpty(data)) {
        FCMData newData = FCMData.fromMap(data!);
        await ss.saveFCMData(newData);
      }

      widget.onConnect();
    }).catchError((err) {
      if (err is Response) {
        error = err.data["error"]["message"];
      } else {
        error = err.toString();
      }
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!connecting) {
      return AlertDialog(
        title: Text(
          "Enter Server Details",
          style: context.theme.textTheme.titleLarge,
        ),
        backgroundColor: context.theme.colorScheme.properSurface,
        content: AutofillGroup(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Focus(
                onKeyEvent: (node, event) {
                  if (event is KeyDownEvent && !HardwareKeyboard.instance.isShiftPressed && event.logicalKey == LogicalKeyboardKey.tab) {
                    node.nextFocus();
                    return KeyEventResult.handled;
                  }
                  return KeyEventResult.ignored;
                },
                child: TextField(
                  cursorColor: context.theme.colorScheme.primary,
                  autocorrect: false,
                  autofocus: true,
                  controller: urlController,
                  textInputAction: TextInputAction.next,
                  autofillHints: [AutofillHints.username, AutofillHints.url],
                  decoration: InputDecoration(
                    enabledBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: context.theme.colorScheme.outline),
                        borderRadius: BorderRadius.circular(20)),
                    focusedBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: context.theme.colorScheme.primary),
                        borderRadius: BorderRadius.circular(20)),
                    labelText: "URL",
                  ),
              ),
              ),
              const SizedBox(height: 10),
              Focus(
                onKeyEvent: (node, event) {
                  if (event is KeyDownEvent && HardwareKeyboard.instance.isShiftPressed && event.logicalKey == LogicalKeyboardKey.tab) {
                    node.previousFocus();
                    node.previousFocus(); // This is intentional. Should probably figure out why it's needed
                    return KeyEventResult.handled;
                  }
                  return KeyEventResult.ignored;
                },
                child: TextField(
                  cursorColor: context.theme.colorScheme.primary,
                  autocorrect: false,
                  autofocus: false,
                  controller: passwordController,
                  textInputAction: TextInputAction.next,
                  autofillHints: [AutofillHints.password],
                  onSubmitted: (_) {
                    connect(urlController.text, passwordController.text);
                    connecting = true;
                    if (mounted) setState(() {});
                  },
                  decoration: InputDecoration(
                    enabledBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: context.theme.colorScheme.outline),
                        borderRadius: BorderRadius.circular(20)),
                    focusedBorder: OutlineInputBorder(
                        borderSide: BorderSide(color: context.theme.colorScheme.primary),
                        borderRadius: BorderRadius.circular(20)),
                    labelText: "Password",
                  ),
                  obscureText: true,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            child: Text("Cancel", style: context.theme.textTheme.bodyLarge!.copyWith(color: context.theme.colorScheme.primary)),
            onPressed: widget.onClose,
          ),
          TextButton(
            child: Text("OK", style: context.theme.textTheme.bodyLarge!.copyWith(color: context.theme.colorScheme.primary)),
            onPressed: () {
              connect(urlController.text, passwordController.text);
              connecting = true;
              if (mounted) setState(() {});
            },
          ),
        ],
      );
    } else if (error == 'Google Services file not found.') {
      return const FailedToScanDialog(
        title: "Connected! However...",
        exception: 'Google Services file not found! If you plan to use Firebase for notifications, please setup Firebase via the BlueBubbles Server.'
      );
    } else if (error != null) {
      return FailedToScanDialog(
        title: "An error occured while trying to retreive data!",
        exception: error,
      );
    } else {
      return ConnectingDialog(
        onConnect: (bool result) {
          if (result) {
            retreiveFCMData();
          } else {
            if (mounted) {
              setState(() {
                error =
                "Failed to connect to ${sanitizeServerAddress()}! Please check that the url is correct (including http://) and the server logs for more info.";
              });
            }
          }
        },
      );
    }
  }
}
