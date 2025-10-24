import 'package:bluebubbles/app/wrappers/stateful_boilerplate.dart';
import 'package:bluebubbles/helpers/types/constants.dart';
import 'package:bluebubbles/app/components/custom/custom_cupertino_page_transition.dart';
import 'package:bluebubbles/app/components/custom/custom_bouncing_scroll_physics.dart';
import 'package:bluebubbles/services/services.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class ThemeSwitcher extends StatefulWidget {
  ThemeSwitcher({super.key, required this.iOSSkin, required this.materialSkin, this.samsungSkin});
  final Widget iOSSkin;
  final Widget materialSkin;
  final Widget? samsungSkin;

  static PageRoute<T> buildPageRoute<T>({required Widget Function(BuildContext context) builder}) {
    switch (ss.settings.skin.value) {
      case Skins.iOS:
        return PageRouteBuilder<T>(pageBuilder: (context, animation, secondaryAnimation) => builder.call(context),
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            return CustomCupertinoPageTransition(primaryRouteAnimation: animation, child: child, linearTransition: false);
          });
      case Skins.Material:
        return MaterialPageRoute<T>(builder: builder);
      case Skins.Samsung:
        return MaterialPageRoute<T>(builder: builder);
      default:
        return PageRouteBuilder<T>(pageBuilder: (context, animation, secondaryAnimation) => builder.call(context),
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            return CustomCupertinoPageTransition(primaryRouteAnimation: animation, child: child, linearTransition: false);
          });
    }
  }

  static ScrollPhysics getScrollPhysics() {
    switch (ss.settings.skin.value) {
      case Skins.iOS:
        return const AlwaysScrollableScrollPhysics(
          parent: CustomBouncingScrollPhysics(),
        );
      case Skins.Material:
        return const AlwaysScrollableScrollPhysics(
          parent: ClampingScrollPhysics(),
        );
      case Skins.Samsung:
        return const AlwaysScrollableScrollPhysics(
          parent: ClampingScrollPhysics(),
        );
      default:
        return const AlwaysScrollableScrollPhysics(
          parent: CustomBouncingScrollPhysics(),
        );
    }
  }

  @override
  State<ThemeSwitcher> createState() => _ThemeSwitcherState();
}

class _ThemeSwitcherState extends OptimizedState<ThemeSwitcher> {

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      switch (ss.settings.skin.value) {
        case Skins.iOS:
          return widget.iOSSkin;
        case Skins.Material:
          return widget.materialSkin;
        case Skins.Samsung:
          return widget.samsungSkin ?? widget.materialSkin;
        default:
          return widget.iOSSkin;
      }
    });
  }
}
