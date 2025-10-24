import 'dart:async';
import 'dart:math';

import 'package:bluebubbles/app/wrappers/stateful_boilerplate.dart';
import 'package:bluebubbles/helpers/helpers.dart';
import 'package:bluebubbles/database/models.dart';
import 'package:bluebubbles/services/services.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tuple/tuple.dart';

class ImageViewer extends StatefulWidget {
  final PlatformFile file;
  final Attachment attachment;
  final bool isFromMe;

  ImageViewer({
    super.key,
    required this.file,
    required this.attachment,
    required this.isFromMe,
    this.controller,
  });

  final ConversationViewController? controller;

  @override
  OptimizedState createState() => _ImageViewerState();
}

class _ImageViewerState extends OptimizedState<ImageViewer> with AutomaticKeepAliveClientMixin {
  Attachment get attachment => widget.attachment;
  PlatformFile get file => widget.file;
  ConversationViewController? get controller => widget.controller;

  Uint8List? data;

  @override
  void initState() {
    super.initState();
    if (attachment.guid!.contains("demo") || controller == null) return;
    data = controller!.imageData[attachment.guid];
    updateObx(() {
      initBytes();
    });
  }

  void initBytes() async {
    if (data != null) return;
    // Try to get the image data from the "cache"
    Uint8List? tmpData = controller!.imageData[attachment.guid];
    if (tmpData == null) {
      final completer = Completer<Uint8List>();
      controller!.queueImage(Tuple4(attachment, file, context, completer));
      final newData = await completer.future;
      if (newData.isEmpty) return;
      setState(() {
        data = newData;
      });
    } else {
      setState(() {
        data = tmpData;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (attachment.guid!.contains("demo")) {
      return Image.asset(attachment.transferName!, fit: BoxFit.cover);
    }
    if (data == null) {
      return SizedBox(
        width: min((attachment.width?.toDouble() ?? ns.width(context) * 0.5), ns.width(context) * 0.5),
        height: min((attachment.height?.toDouble() ?? ns.width(context) * 0.5 / attachment.aspectRatio), ns.width(context) * 0.5 / attachment.aspectRatio),
      );
    }
    return Image.memory(
      data!,
      // prevents the image widget from "refreshing" when the provider changes
      gaplessPlayback: true,
      filterQuality: FilterQuality.none,
      cacheWidth: (min((attachment.width ?? 0), ns.width(context) * 0.5) * Get.pixelRatio / 2).round().abs().nonZero,
      cacheHeight: (min((attachment.height ?? 0), ns.width(context) * 0.5 / attachment.aspectRatio) * Get.pixelRatio / 2).round().abs().nonZero,
      fit: BoxFit.cover,
      frameBuilder: (context, w, frame, wasSyncLoaded) {
        return AnimatedCrossFade(
          crossFadeState: frame == null ? CrossFadeState.showFirst : CrossFadeState.showSecond,
          alignment: Alignment.center,
          duration: const Duration(milliseconds: 150),
          secondChild: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: 40,
              minWidth: 100,
            ),
            child: Stack(
              alignment: !widget.isFromMe ? Alignment.topRight : Alignment.topLeft,
              children: [
                w,
                if (attachment.hasLivePhoto)
                  const Padding(
                    padding: EdgeInsets.all(10.0),
                    child: Icon(CupertinoIcons.smallcircle_circle, color: Colors.white, size: 20),
                  ),
              ],
            ),
          ),
          firstChild: SizedBox(
            width: min((attachment.width?.toDouble() ?? ns.width(context) * 0.5), ns.width(context) * 0.5),
            height: min((attachment.height?.toDouble() ?? ns.width(context) * 0.5 / attachment.aspectRatio), ns.width(context) * 0.5 / attachment.aspectRatio),
          )
        );
      },
      errorBuilder: (context, object, stacktrace) => Center(
        heightFactor: 1,
        child: Text("Failed to display image", style: context.theme.textTheme.bodyLarge),
      ),
    );
  }

  @override
  bool get wantKeepAlive => true;
}
