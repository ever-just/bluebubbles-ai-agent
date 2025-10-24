import 'package:bluebubbles/helpers/helpers.dart';
import 'package:bluebubbles/app/layouts/conversation_list/pages/conversation_list.dart';
import 'package:bluebubbles/app/layouts/conversation_list/widgets/header/header_widgets.dart';
import 'package:bluebubbles/app/layouts/conversation_list/pages/search/search_view.dart';
import 'package:bluebubbles/app/wrappers/stateful_boilerplate.dart';
import 'package:bluebubbles/services/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_acrylic/flutter_acrylic.dart';
import 'package:get/get.dart';

class SamsungHeader extends CustomStateful<ConversationListController> {
  const SamsungHeader({Key? key, required super.parentController});

  @override
  State<StatefulWidget> createState() => _SamsungHeaderState();
}

class _SamsungHeaderState extends CustomState<SamsungHeader, void, ConversationListController> {
  Color get backgroundColor => ss.settings.windowEffect.value == WindowEffect.disabled
      ? headerColor
      : Colors.transparent;
  bool get showArchived => controller.showArchivedChats;
  bool get showUnknown => controller.showUnknownSenders;

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      ns.listener.value;
      if (ns.isAvatarOnly(context)) {
        return SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(10.0).add(const EdgeInsets.only(top: 30)),
            child: Material(
              color: Colors.transparent,
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: SizedBox(
                width: 40,
                child: OverflowMenu(extraItems: true, controller: controller),
              ),
            ),
          ),
        );
      }
      return SliverAppBar(
        backgroundColor: backgroundColor,
        shadowColor: Colors.black,
        pinned: true,
        stretch: true,
        expandedHeight: context.height / 3,
        toolbarHeight: kToolbarHeight + (kIsDesktop ? 20 : 0),
        elevation: 0,
        scrolledUnderElevation: 0,
        automaticallyImplyLeading: false,
        flexibleSpace: LayoutBuilder(
          builder: (context, constraints) {
            final double expandRatio = ((constraints.maxHeight - (kToolbarHeight + (kIsDesktop ? 20 : 0))) / (context.height / 3 - (kToolbarHeight + (kIsDesktop ? 20 : 0)))).clamp(0, 1);
            final animation = AlwaysStoppedAnimation(expandRatio);

            return Stack(
              fit: StackFit.expand,
              children: [
                FadeTransition(
                  opacity: Tween(begin: 0.0, end: 1.0).animate(CurvedAnimation(
                    parent: animation,
                    curve: const Interval(0.3, 1.0, curve: Curves.easeIn),
                  )),
                  child: Center(child: ExpandedHeaderText(parentController: controller)),
                ),
                FadeTransition(
                  opacity: Tween(begin: 1.0, end: 0.0).animate(CurvedAnimation(
                    parent: animation,
                    curve: const Interval(0.0, 0.7, curve: Curves.easeOut),
                  )),
                  child: Align(
                    alignment: Alignment.bottomLeft,
                    child: Container(
                      padding: EdgeInsets.only(left: showArchived || showUnknown ? 60 : 16),
                      height: (kToolbarHeight + (kIsDesktop ? 20 : 0)),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            HeaderText(controller: controller, fontSize: 20),
                            SyncIndicator(),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                Align(
                  alignment: Alignment.bottomRight,
                  child: Container(
                    height: (kToolbarHeight + (kIsDesktop ? 20 : 0)),
                    child: Align(
                      alignment: Alignment.center,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          if (showArchived || showUnknown)
                            IconButton(
                                onPressed: () async {
                                  Navigator.of(context).pop();
                                },
                                padding: EdgeInsets.zero,
                                icon: buildBackButton(context)
                            ),
                          if (!showArchived && !showUnknown)
                            const SizedBox.shrink(),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (!showArchived && !showUnknown)
                                Padding(
                                  padding: const EdgeInsets.only(left: 2),
                                  child: IconButton(
                                    onPressed: () async {
                                      controller.openCamera(context);
                                    },
                                    icon: Icon(
                                      Icons.camera_alt_outlined,
                                      color: context.theme.colorScheme.properOnSurface,
                                    ),
                                  )),
                              if (!showArchived && !showUnknown)
                                IconButton(
                                  onPressed: () async {
                                    ns.pushLeft(
                                      context,
                                      SearchView(),
                                    );
                                  },
                                  icon: Icon(
                                    Icons.search,
                                    color: context.theme.colorScheme.properOnSurface,
                                  )),
                              if (!showArchived && !showUnknown)
                                const Padding(
                                  padding: EdgeInsets.only(right: 8.0),
                                  child: Material(
                                    color: Colors.transparent,
                                    shape: CircleBorder(),
                                    clipBehavior: Clip.antiAlias,
                                    child: SizedBox(
                                      width: 40,
                                      child: OverflowMenu(),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      );
    });
  }
}

class ExpandedHeaderText extends CustomStateful<ConversationListController> {
  const ExpandedHeaderText({Key? key, required super.parentController});

  @override
  State<StatefulWidget> createState() => _ExpandedHeaderTextState();
}

class _ExpandedHeaderTextState extends CustomState<ExpandedHeaderText, void, ConversationListController> {
  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final unreadChats = GlobalChatService.unreadCount.value;
      return Text(
          controller.selectedChats.isNotEmpty
              ? "${controller.selectedChats.length} selected"
              : controller.showArchivedChats
              ? "Archived"
              : controller.showUnknownSenders
              ? "Unknown Senders"
              : unreadChats > 0
              ? "$unreadChats unread message${unreadChats > 1 ? "s" : ""}"
              : "Messages",
          style: context.theme.textTheme.displaySmall!.copyWith(color: context.theme.colorScheme.onBackground),
        textAlign: TextAlign.center,
      );
    });
  }
}