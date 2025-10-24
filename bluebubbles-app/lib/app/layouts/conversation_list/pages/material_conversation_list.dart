import 'package:bluebubbles/helpers/helpers.dart';
import 'package:bluebubbles/app/layouts/conversation_list/pages/conversation_list.dart';
import 'package:bluebubbles/app/layouts/conversation_list/widgets/conversation_list_fab.dart';
import 'package:bluebubbles/app/layouts/conversation_list/widgets/header/material_header.dart';
import 'package:bluebubbles/app/layouts/conversation_list/widgets/tile/list_item.dart';
import 'package:bluebubbles/app/wrappers/stateful_boilerplate.dart';
import 'package:bluebubbles/app/wrappers/scrollbar_wrapper.dart';
import 'package:bluebubbles/app/wrappers/theme_switcher.dart';
import 'package:bluebubbles/services/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_acrylic/flutter_acrylic.dart';
import 'package:get/get.dart';

class MaterialConversationList extends StatefulWidget {
  const MaterialConversationList({Key? key, required this.parentController});

  final ConversationListController parentController;

  @override
  State<MaterialConversationList> createState() => _MaterialConversationListState();
}

class _MaterialConversationListState extends OptimizedState<MaterialConversationList> {
  bool get showArchived => widget.parentController.showArchivedChats;
  bool get showUnknown => widget.parentController.showUnknownSenders;
  Color get backgroundColor => ss.settings.windowEffect.value == WindowEffect.disabled
      ? context.theme.colorScheme.background
      : Colors.transparent;
  ConversationListController get controller => widget.parentController;

  @override
  void initState() {
    super.initState();
    // update widget when background color changes
    if (kIsDesktop) {
      ss.settings.windowEffect.listen((WindowEffect effect) {
        setState(() {});
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: <T>(bool didPop, T? other) {
        if (didPop) return;
        if (controller.selectedChats.isNotEmpty) {
          controller.clearSelectedChats();
          return;
        } else if (controller.showArchivedChats || controller.showUnknownSenders) {
          // Pop the current page
          Navigator.of(context).pop();
        } else {
          // Pop the app to exit the app
          SystemNavigator.pop();
        }
      },
      child: Container(
        color: backgroundColor,
        padding: EdgeInsets.only(top: kIsDesktop ? 30 : 0),
        child: Scaffold(
          appBar: PreferredSize(
            preferredSize: const Size.fromHeight(60),
            child: MaterialHeader(parentController: controller),
          ),
          backgroundColor: backgroundColor,
          extendBodyBehindAppBar: true,
          floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
          floatingActionButton: !showArchived && !showUnknown
              ? ConversationListFAB(parentController: controller)
              : const SizedBox.shrink(),
          body: Obx(() {
            final _chats = chats.chats.archivedHelper(showArchived).unknownSendersHelper(showUnknown);

            if (!chats.loadedChatBatch.value || _chats.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.only(top: 100),
                  child: Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(8.0),
                        child: Text(
                          !chats.loadedChatBatch.value
                              ? "Loading chats..."
                              : showArchived
                                  ? "You have no archived chats"
                                  : showUnknown
                                      ? "You have no messages from unknown senders :)"
                                      : "You have no chats :(",
                          style: context.theme.textTheme.labelLarge,
                          textAlign: TextAlign.center,
                        ),
                      ),
                      if (!chats.loadedChatBatch.value) buildProgressIndicator(context, size: 15),
                    ],
                  ),
                ),
              );
            }

            return NotificationListener(
              onNotification: (notif) {
                if (notif is ScrollStartNotification) {
                  controller.materialScrollStartPosition = controller.materialScrollController.offset;
                }
                return true;
              },
              child: ScrollbarWrapper(
                showScrollbar: true,
                controller: controller.materialScrollController,
                child: Obx(() => ListView.builder(
                      controller: controller.materialScrollController,
                      physics: ThemeSwitcher.getScrollPhysics(),
                      findChildIndexCallback: (key) => findChildIndexByKey(_chats, key, (item) => item.guid),
                      itemBuilder: (context, index) {
                        final chat = _chats[index];
                        return Container(
                          key: ValueKey(chat.guid),
                          child: ListItem(
                            chat: chat,
                            controller: controller,
                            update: () {
                              setState(() {});
                            }
                          )
                        );
                      },
                      itemCount: _chats.length,
                    )),
              ),
            );
          }),
        ),
      ),
    );
  }
}
