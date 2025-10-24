import 'dart:convert';

import 'package:bluebubbles/helpers/helpers.dart';
import 'package:bluebubbles/services/services.dart';
import 'package:bluebubbles/database/models.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:metadata_fetch/metadata_fetch.dart';
import 'package:share_plus/share_plus.dart' as sp;
import 'package:tuple/tuple.dart';
import 'package:universal_io/io.dart';

class Share {
  /// Share a file with other apps.
  static void file(String subject, String filepath) async {
    if (kIsDesktop) {
      showSnackbar("Unsupported", "Can't share files on desktop yet!");
    } else {
      sp.Share.shareXFiles([sp.XFile(filepath)], text: subject);
    }
  }

  /// Share text with other apps.
  static void text(String subject, String text) {
    sp.Share.share(text, subject: subject);
  }

  static Future<void> location(Chat chat) async {
    bool _serviceEnabled;
    LocationPermission _permissionGranted;
    Position _locationData;

    _serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!_serviceEnabled) {
      await showDialog(
          context: Get.context!,
          builder: (context) => AlertDialog(
                backgroundColor: Get.theme.colorScheme.properSurface,
                title: Text(
                  "Location Services",
                  style: Get.textTheme.titleLarge,
                ),
                content: Text(
                  "Location Services must be enabled to send Locations",
                  style: Get.textTheme.bodyLarge,
                ),
                actions: [
                  if (!kIsDesktop || !Platform.isLinux)
                    TextButton(
                        onPressed: () => Get.back(),
                        child: Text("Cancel", style: context.theme.textTheme.bodyLarge!.copyWith(color: context.theme.colorScheme.primary))),
                  if (!kIsDesktop || !Platform.isLinux)
                    TextButton(
                        onPressed: () async => await Geolocator.openLocationSettings(),
                        child: Text("Open Settings", style: context.theme.textTheme.bodyLarge!.copyWith(color: context.theme.colorScheme.primary))),
                  if (kIsDesktop && Platform.isLinux)
                    TextButton(
                        onPressed: () => Get.back(),
                        child: Text("OK", style: context.theme.textTheme.bodyLarge!.copyWith(color: context.theme.colorScheme.primary))),
                ],
              ));
      if (!_serviceEnabled) {
        return;
      }
    }

    if (!kIsDesktop || !Platform.isLinux) {
      _permissionGranted = await Geolocator.checkPermission();
      if (_permissionGranted == LocationPermission.denied) {
        _permissionGranted = await Geolocator.requestPermission();
      }
      if (_permissionGranted == LocationPermission.denied || _permissionGranted == LocationPermission.deniedForever) {
        await showDialog(
            context: Get.context!,
            builder: (context) => AlertDialog(
                  backgroundColor: Get.theme.colorScheme.properSurface,
                  title: Text("Location Permission", style: Get.textTheme.titleLarge),
                  content: Text(
                    "BlueBubbles needs the Location permission to send Locations",
                    style: Get.textTheme.bodyLarge,
                  ),
                  actions: [
                    TextButton(
                        onPressed: () => Get.back(),
                        child: Text("Cancel", style: Get.textTheme.bodyLarge!.copyWith(color: Get.theme.colorScheme.primary))),
                    TextButton(
                        onPressed: () async => await Geolocator.openLocationSettings(),
                        child: Text("Open Settings", style: Get.textTheme.bodyLarge!.copyWith(color: Get.theme.colorScheme.primary)))
                  ],
                ));
        if (_permissionGranted == LocationPermission.denied || _permissionGranted == LocationPermission.deniedForever) {
          return;
        }
      }
    }

    String? _attachmentGuid;
    String? fileName;
    late final Uint8List bytes;
    String? url;
    String? title;

    Future<Tuple5<String, String, Uint8List, String, String?>> getLocationPreview() async {
      _locationData = await Geolocator.getCurrentPosition();
      String vcfString = as.createAppleLocation(_locationData.latitude, _locationData.longitude);

      // Build out the file we are going to send
      String _attachmentGuid = "temp-${randomString(8)}";
      String fileName = "$_attachmentGuid-CL.loc.vcf";
      final bytes = Uint8List.fromList(utf8.encode(vcfString));
      final meta = await MetadataFetch.extract(
          "https://maps.apple.com/?ll=${_locationData.latitude},${_locationData.longitude}&q=${_locationData.latitude},${_locationData.longitude}");
      String url = meta!.image!;
      String? title = meta.title;

      return Tuple5(_attachmentGuid, fileName, bytes, url, title);
    }

    bool send = false;
    if (kIsDesktop || kIsWeb) {
      cvc(chat).showingOverlays = true;
    }
    await showDialog(
        context: Get.context!,
        builder: (context) => FutureBuilder(
            future: getLocationPreview(),
            builder: (context, snapshot) {
              if (snapshot.data != null) {
                _attachmentGuid = snapshot.data!.item1;
                fileName = snapshot.data!.item2;
                bytes = snapshot.data!.item3;
                url = snapshot.data!.item4;
                title = snapshot.data!.item5;
              }
              if (url == null) {
                return AbsorbPointer(
                  child: AlertDialog(
                    backgroundColor: Get.theme.colorScheme.properSurface,
                    title: Text("Loading Location...", style: Get.textTheme.titleLarge),
                    content: buildProgressIndicator(context),
                  ),
                );
              }
              return AlertDialog(
                backgroundColor: Get.theme.colorScheme.properSurface,
                title: Text("Send Location?", style: Get.textTheme.titleLarge),
                content: Container(
                  width: 150,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Image.network(
                        url!,
                        gaplessPlayback: true,
                        filterQuality: FilterQuality.none,
                        errorBuilder: (_, __, ___) {
                          return const SizedBox.shrink();
                        },
                        frameBuilder: (_, child, frame, __) {
                          if (frame == null) {
                            return Center(
                              heightFactor: 1,
                              child: buildProgressIndicator(context),
                            );
                          } else {
                            return child;
                          }
                        },
                      ),
                      const SizedBox(height: 15),
                      Text(
                        title ?? "No location details found",
                        style: context.theme.textTheme.bodyMedium!.apply(fontWeightDelta: 2),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                actions: [
                  TextButton(
                      onPressed: () => Get.back(),
                      child: Text("Cancel", style: Get.textTheme.bodyLarge!.copyWith(color: Get.theme.colorScheme.primary))),
                  TextButton(
                      onPressed: () {
                        send = true;
                        Get.back();
                      },
                      child: Text("Send", style: Get.textTheme.bodyLarge!.copyWith(color: Get.theme.colorScheme.primary)))
                ],
              );
            }));
    if (kIsDesktop || kIsWeb) {
      cvc(chat).showingOverlays = false;
    }

    if (!send) return;

    final message = Message(
      guid: _attachmentGuid,
      text: "",
      dateCreated: DateTime.now(),
      hasAttachments: true,
      attachments: [
        Attachment(
          guid: _attachmentGuid,
          mimeType: "text/x-vlocation",
          isOutgoing: true,
          uti: "public.vlocation",
          bytes: bytes,
          transferName: fileName,
          totalBytes: bytes.length,
        ),
      ],
      isFromMe: true,
      handleId: 0,
    );

    outq.queue(OutgoingItem(
      type: QueueType.sendAttachment,
      chat: chat,
      message: message,
    ));
  }
}
